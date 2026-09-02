#!/usr/bin/env python3
"""Build refs/sync/mirror: upstream's history, speaking Manta.

Every commit of upstream/main is re-emitted with brand_rule applied to its
tree — file contents and paths — with author, dates and message preserved and
a `Mirror-Of:` trailer naming the upstream commit. The result is what upstream
would look like if it had been this fork all along, so a sync is a real rebase
of the fork's own commits onto it: conflicts are only where both sides changed
the same code, never where one side spells the product differently.

The mirror is regenerated from scratch every time. It is deterministic in
(upstream tree, evidence ref), and upstream rewrites its history anyway, so
there is nothing to preserve.

Evidence for the rename is the fork's own tree (`--evidence`, default main):
a token is renamed only if the fork already uses its Manta form. That is read
once into memory; the whole build is then a streaming pass through
`git fast-import`, referencing unchanged blobs by SHA and emitting only the
transformed ones.

Usage:
  build-mirror.py [--upstream upstream/main] [--evidence main]
                  [--ref refs/sync/mirror] [--report]
"""
import argparse
import os
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from brand_rule import Evidence, rebrand_text, TOKEN  # noqa: E402

BRAND = re.compile(rb'orca', re.IGNORECASE)


def git(*args, **kw):
    return subprocess.run(['git', *args], capture_output=True, check=True, **kw)


def commits(upstream):
    return git('rev-list', '--reverse', '--topo-order', upstream).stdout.decode().split()


def ls_tree(rev):
    """[(mode, sha, path)] for a commit."""
    out = git('ls-tree', '-r', '-z', rev).stdout
    entries = []
    for rec in out.split(b'\0'):
        if not rec:
            continue
        meta, path = rec.split(b'\t', 1)
        mode, _type, sha = meta.decode().split(' ')
        entries.append((mode, sha, path.decode('utf-8', 'surrogateescape')))
    return entries


def diff_tree(prev, cur):
    """[(status, mode, sha, path)] with status in A/M/D/T; no rename detection."""
    out = git('diff-tree', '-r', '-z', '--no-renames', prev, cur).stdout
    fields = out.split(b'\0')
    result, i = [], 0
    while i < len(fields) and fields[i]:
        meta = fields[i].decode()
        path = fields[i + 1].decode('utf-8', 'surrogateescape')
        # :<old-mode> <new-mode> <old-sha> <new-sha> <status>
        _, new_mode, _, new_sha, status = meta[1:].split(' ')
        result.append((status[0], new_mode, new_sha, path))
        i += 2
    return result


def read_blobs(shas):
    """{sha: bytes} via one cat-file --batch."""
    if not shas:
        return {}
    proc = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    out, _ = proc.communicate(('\n'.join(shas) + '\n').encode())
    blobs, pos = {}, 0
    for sha in shas:
        nl = out.index(b'\n', pos)
        header = out[pos:nl].decode()
        pos = nl + 1
        parts = header.split(' ')
        if parts[-1] == 'missing':
            continue
        size = int(parts[2])
        blobs[sha] = out[pos:pos + size]
        pos += size + 1
    return blobs


class Mirror:
    def __init__(self, evidence_ref, upstream):
        self.upstream = upstream
        self.evidence_ref = evidence_ref
        self.blob_out = {}      # upstream blob sha -> (mark or sha, changed?)
        self.path_out = {}      # upstream path -> mirror path
        self.marks = 0
        self.declined = {}
        self.renamed_tokens = set()
        self.stats = {'blobs_seen': 0, 'blobs_transformed': 0, 'paths_renamed': 0, 'commits': 0}

    # ---- evidence -------------------------------------------------------
    def collect_tokens(self, revs):
        """Every brand token in every distinct brand-bearing blob across the history."""
        seen, brand_shas = set(), []
        for rev in revs:
            for _mode, sha, _path in ls_tree(rev):
                if sha in seen:
                    continue
                seen.add(sha)
                brand_shas.append(sha)
        tokens = set()
        # Read in chunks so a 30k-object history does not sit in memory at once.
        self.brand_blobs = set()
        for i in range(0, len(brand_shas), 2000):
            chunk = read_blobs(brand_shas[i:i + 2000])
            for sha, data in chunk.items():
                if not BRAND.search(data):
                    continue
                self.brand_blobs.add(sha)
                try:
                    text = data.decode('utf-8')
                except UnicodeDecodeError:
                    continue
                tokens.update(m.group(0) for m in TOKEN.finditer(text))
        return tokens

    # ---- transform ------------------------------------------------------
    def out_path(self, path):
        if path not in self.path_out:
            new = self.evidence.path_twin(path)
            self.path_out[path] = new
            if new != path:
                self.stats['paths_renamed'] += 1
        return self.path_out[path]

    def emit_blob(self, w, sha, data):
        """Return the dataref for this blob in the mirror: its own sha if untouched,
        a mark if transformed."""
        if sha in self.blob_out:
            return self.blob_out[sha]
        self.stats['blobs_seen'] += 1
        if sha not in self.brand_blobs:
            self.blob_out[sha] = sha
            return sha
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            self.blob_out[sha] = sha
            return sha
        new, renamed, declined = rebrand_text(text, evidence=self.evidence)
        self.renamed_tokens.update(renamed)
        for tok in declined:
            self.declined[tok] = self.declined.get(tok, 0) + 1
        if new == text:
            self.blob_out[sha] = sha
            return sha
        self.marks += 1
        mark = f':{self.marks}'
        payload = new.encode('utf-8')
        w.write(f'blob\nmark {mark}\ndata {len(payload)}\n'.encode())
        w.write(payload)
        w.write(b'\n')
        self.blob_out[sha] = mark
        self.stats['blobs_transformed'] += 1
        return mark

    # ---- build ----------------------------------------------------------
    def build(self, ref):
        revs = commits(self.upstream)
        print(f'  upstream {self.upstream}: {len(revs)} commits', file=sys.stderr)
        tokens = self.collect_tokens(revs)
        print(f'  {len(self.brand_blobs)} brand-bearing blobs, {len(tokens)} distinct tokens', file=sys.stderr)
        self.evidence = Evidence(self.evidence_ref, tokens)
        print(f'  evidence {self.evidence_ref}: {len(self.evidence.twins)} Manta twins present', file=sys.stderr)

        proc = subprocess.Popen(['git', 'fast-import', '--quiet', '--force'], stdin=subprocess.PIPE)
        w = proc.stdin
        prev_rev, prev_mark = None, None
        for n, rev in enumerate(revs, 1):
            if prev_rev is None:
                changes = [('A', mode, sha, path) for mode, sha, path in ls_tree(rev)]
            else:
                changes = diff_tree(prev_rev, rev)
            need = [sha for st, _m, sha, _p in changes if st != 'D' and sha in self.brand_blobs and sha not in self.blob_out]
            blobs = read_blobs(need)

            lines = []
            seen_out = {}
            for st, mode, sha, path in changes:
                out_p = self.out_path(path)
                if st == 'D':
                    lines.append(f'D {out_p}\n'.encode('utf-8', 'surrogateescape'))
                    continue
                if mode in ('120000', '160000'):      # symlink, submodule: as-is
                    ref_ = sha
                else:
                    ref_ = self.emit_blob(w, sha, blobs.get(sha, b''))
                if out_p in seen_out and seen_out[out_p] != path:
                    sys.exit(f'path collision in {rev[:10]}: {seen_out[out_p]} and {path} both map to {out_p}')
                seen_out[out_p] = path
                lines.append(f'M {mode} {ref_} {out_p}\n'.encode('utf-8', 'surrogateescape'))

            meta = git('log', '-1', '--format=%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B', rev).stdout
            an, ae, at, cn, ce, ct, body = meta.decode('utf-8', 'surrogateescape').split('\0', 6)
            body = body.rstrip('\n') + f'\n\nMirror-Of: {rev}\n'
            body_b = body.encode('utf-8', 'surrogateescape')
            self.marks += 1
            cmark = f':{self.marks}'
            w.write(f'commit {ref}\nmark {cmark}\n'.encode())
            w.write(f'author {an} <{ae}> {at} +0000\n'.encode('utf-8', 'surrogateescape'))
            w.write(f'committer {cn} <{ce}> {ct} +0000\n'.encode('utf-8', 'surrogateescape'))
            w.write(f'data {len(body_b)}\n'.encode())
            w.write(body_b + b'\n')
            if prev_mark:
                w.write(f'from {prev_mark}\n'.encode())
            for line in lines:
                w.write(line)
            w.write(b'\n')
            prev_rev, prev_mark = rev, cmark
            self.stats['commits'] += 1
            if n % 50 == 0 or n == len(revs):
                print(f'  {n}/{len(revs)} commits, {self.stats["blobs_transformed"]} blobs transformed', file=sys.stderr)
        w.close()
        if proc.wait() != 0:
            sys.exit('git fast-import failed')
        return git('rev-parse', ref).stdout.decode().strip()


def report(mirror, evidence_ref):
    """How much of the fork the mirror already reproduces."""
    m = {p: (mode, sha) for mode, sha, p in ls_tree(mirror)}
    f = {p: (mode, sha) for mode, sha, p in ls_tree(evidence_ref)}
    both = set(m) & set(f)
    same = sum(1 for p in both if m[p][1] == f[p][1])
    print(f'\n  mirror vs {evidence_ref}:')
    print(f'    {len(both)} shared paths, {same} byte-identical ({100 * same / max(1, len(both)):.1f}%)')
    print(f'    {len(both) - same} differ  — the fork\'s own edits inside upstream files')
    print(f'    {len(set(f) - set(m))} only in fork, {len(set(m) - set(f))} only in mirror')
    diff_paths = sorted(p for p in both if m[p][1] != f[p][1])
    by_area = {}
    for p in diff_paths:
        area = p.split('/')[0] if '/' in p else '(root)'
        if area in ('src', 'mobile') and p.count('/') > 1:
            area = '/'.join(p.split('/')[:2])
        by_area[area] = by_area.get(area, 0) + 1
    for area, n in sorted(by_area.items(), key=lambda kv: -kv[1])[:12]:
        print(f'      {n:5d}  {area}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--upstream', default='upstream/main')
    ap.add_argument('--evidence', default='main')
    ap.add_argument('--ref', default='refs/sync/mirror')
    ap.add_argument('--report', action='store_true')
    a = ap.parse_args()
    os.chdir(git('rev-parse', '--show-toplevel').stdout.decode().strip())

    mirror = Mirror(a.evidence, a.upstream)
    tip = mirror.build(a.ref)
    s = mirror.stats
    print(f'\n  {a.ref} = {tip[:12]}')
    print(f'  {s["commits"]} commits · {s["blobs_transformed"]}/{s["blobs_seen"]} blobs transformed · {s["paths_renamed"]} paths renamed')
    print(f'  {len(mirror.renamed_tokens)} distinct tokens renamed, {len(mirror.declined)} declined (no Manta twin)')
    if a.report:
        report(a.ref, a.evidence)
    decl = sorted(mirror.declined.items(), key=lambda kv: -kv[1])
    if decl:
        print('\n  declined (top 20 — the next naming decisions live here):')
        for tok, n in decl[:20]:
            print(f'    {n:5d}  {tok}')


if __name__ == '__main__':
    main()
