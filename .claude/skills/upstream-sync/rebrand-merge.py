#!/usr/bin/env python3
"""Resolve rebrand-shaped conflicts by speaking Manta to both sides of the merge.

Every conflict in this fork has the same root: upstream's file says Orca, ours
says Manta, so git sees two different lines where there is one change. Rewriting
the base and the incoming side into Manta first turns most of them back into the
ordinary three-way merges they actually are.

Usage:  rebrand-merge.py [--apply]     (default is a dry run)
"""
import re, subprocess, sys, pathlib, os

# Files this fork rewrote rather than adapted. Upstream's edits to them are
# about upstream's product — its App Store listing, its APK links, its cloud —
# so ours wins outright. Every skip is printed: if upstream ever adds something
# here worth having, that line is where it gets noticed.
FORK_OWNED = {
    'README.md',
    'docs/readme/README.zh-CN.md',
}

IDENTITY = [
    ('stablyai/orca', 'paidaxingyo666/Manta'),
    ('ai.stably.orca', 'cn.sh.manta'),
    ('onorca.dev', 'manta.sh.cn'),
]

def rebrand(data: bytes) -> bytes:
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return data
    for upstream, ours in IDENTITY:
        text = text.replace(upstream, ours)
    text = text.replace('ORCA', 'MANTA').replace('Orca', 'Manta').replace('orca', 'manta')
    # Upstream writes "an Orca"; the rename leaves the article behind.
    text = re.sub(r'\ban Manta\b', 'a Manta', text)
    text = re.sub(r'\bAn Manta\b', 'A Manta', text)
    return text.encode('utf-8')

def stage(n, path):
    r = subprocess.run(['git', 'show', f':{n}:{path}'], capture_output=True)
    return None if r.returncode else r.stdout

def conflicted():
    out = subprocess.run(['git', 'diff', '--name-only', '--diff-filter=U'],
                         capture_output=True, text=True).stdout
    return [p for p in out.splitlines() if p]

def status_map():
    """Two-letter status per unmerged path — UD and DD never reach the stages."""
    out = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout
    return {line[3:]: line[:2] for line in out.splitlines() if line[:2] in ('UD', 'DU', 'AA', 'UU', 'DD', 'AU', 'UA')}

def picked_commit():
    head = pathlib.Path('.git/CHERRY_PICK_HEAD')
    return head.read_text().strip() if head.exists() else None

def blob_at(rev, path):
    r = subprocess.run(['git', 'show', f'{rev}:{path}'], capture_output=True)
    return None if r.returncode else r.stdout

def rebrand_path(path):
    return path.replace('ORCA', 'MANTA').replace('Orca', 'Manta').replace('orca', 'manta')

def main():
    apply = '--apply' in sys.argv
    tmp = pathlib.Path(os.environ.get('TMPDIR', '/tmp')) / 'rebrand-merge'
    tmp.mkdir(parents=True, exist_ok=True)
    clean, still, skipped = [], [], []

    states = status_map()
    picked = picked_commit()

    for path in conflicted():
        state = states.get(path, '??')

        # A lockfile is generated, not authored. Merging one produces a file that
        # resolves to nothing real; upstream's is the one that matches upstream's
        # dependency graph, and `pnpm install --lockfile-only` afterwards folds
        # this fork's own package.json back in.
        if path in FORK_OWNED:
            ours = stage(2, path)
            if ours is not None:
                clean.append(f'{path}  (fork-owned, kept ours — check upstream diff if it matters)')
                if apply:
                    pathlib.Path(path).write_bytes(ours)
                    subprocess.run(['git', 'add', '--', path], check=True)
                continue

        if path == 'pnpm-lock.yaml':
            theirs = stage(3, path)
            if theirs is not None:
                clean.append(f'{path}  (took upstream, regenerate before committing the sync)')
                if apply:
                    pathlib.Path(path).write_bytes(theirs)
                    subprocess.run(['git', 'add', '--', path], check=True)
                continue

        # Upstream deleted it (usually a revert). Taking the deletion is right
        # when our copy differs from theirs only by the brand — anything else is
        # a fork change about to be thrown away, so stop and let a person look.
        if state == 'UD':
            ours_head = blob_at('HEAD', path)
            base_up = blob_at(f'{picked}^', path) if picked else None
            if ours_head is not None and base_up is not None and rebrand(base_up) == ours_head:
                clean.append(f'{path}  (accepted upstream deletion)')
                if apply:
                    subprocess.run(['git', 'rm', '-q', '--', path], check=True)
                continue
            still.append((path, 'deleted upstream, but our copy is not brand-only'))
            continue

        # We renamed it during the rebrand, so git sees a delete. Upstream's
        # change belongs on our renamed twin.
        if state == 'DU':
            twin = rebrand_path(path)
            twin_blob = blob_at('HEAD', twin) if twin != path else None
            if twin_blob is not None:
                # The rebrand renamed the file, so git reports a delete against a
                # path that still exists upstream. Upstream's change belongs on
                # our twin; the old path goes away.
                base_up = blob_at(f'{picked}^', path) if picked else None
                theirs_up = blob_at(picked, path) if picked else None
                if base_up is None or theirs_up is None:
                    still.append((path, f'renamed to {twin}, but the picked commit has no blob'))
                    continue
                files = {}
                for name, blob in (('base', rebrand(base_up)), ('ours', twin_blob),
                                   ('theirs', rebrand(theirs_up))):
                    f = tmp / f'{name}.blob'
                    f.write_bytes(blob)
                    files[name] = str(f)
                merged = subprocess.run(
                    ['git', 'merge-file', '-p', '--diff3',
                     '-L', 'ours', '-L', 'base(rebranded)', '-L', 'upstream(rebranded)',
                     files['ours'], files['base'], files['theirs']],
                    capture_output=True)
                if merged.returncode == 0:
                    clean.append(f'{path}  → {twin}')
                    if apply:
                        pathlib.Path(twin).write_bytes(merged.stdout)
                        subprocess.run(['git', 'add', '--', twin], check=True)
                        subprocess.run(['git', 'rm', '-q', '--ignore-unmatch', '--', path], check=True)
                else:
                    still.append((path, f'conflicts even onto {twin}'))
                continue
            # The fork dropped this file on purpose — the README translations it
            # does not maintain, for one. Our own history carrying the delete is
            # what separates that from "we simply never received the commit that
            # added it", which must not be resolved by deleting anything.
            deleted_by_us = subprocess.run(
                ['git', 'log', '--diff-filter=D', '--format=%h', '-1', 'HEAD', '--', path],
                capture_output=True, text=True).stdout.strip()
            if deleted_by_us:
                clean.append(f'{path}  (fork dropped it in {deleted_by_us})')
                if apply:
                    subprocess.run(['git', 'rm', '-q', '--ignore-unmatch', '--', path], check=True)
                continue
            still.append((path, 'upstream modified a path we have never had'))
            continue

        base, ours, theirs = stage(1, path), stage(2, path), stage(3, path)
        if ours is None or theirs is None:
            skipped.append((path, f'{state}: no ours/theirs stage'))
            continue
        if base is None:
            # add/add: no shared history to merge against. If rebranding theirs
            # reproduces ours exactly, upstream only touched brand strings.
            if rebrand(theirs) == ours:
                clean.append(path)
                if apply:
                    # Write before staging. The working tree still holds the file
                    # git left behind, conflict markers and all, and `git add`
                    # alone would stage those — silently, with a zero exit.
                    pathlib.Path(path).write_bytes(ours)
                    subprocess.run(['git', 'add', '--', path], check=True)
                continue
            skipped.append((path, 'add/add, not brand-only'))
            continue

        files = {}
        for name, blob in (('base', rebrand(base)), ('ours', ours), ('theirs', rebrand(theirs))):
            f = tmp / f'{name}.blob'
            f.write_bytes(blob)
            files[name] = str(f)
        merged = subprocess.run(
            ['git', 'merge-file', '-p', '--diff3',
             '-L', 'ours', '-L', 'base(rebranded)', '-L', 'upstream(rebranded)',
             files['ours'], files['base'], files['theirs']],
            capture_output=True)
        if merged.returncode == 0:
            clean.append(path)
            if apply:
                pathlib.Path(path).write_bytes(merged.stdout)
                subprocess.run(['git', 'add', '--', path], check=True)
        else:
            still.append((path, merged.returncode))

    print(f'rebrand 后可自动合并: {len(clean)}')
    print(f'仍有真冲突:        {len(still)}')
    print(f'跳过:              {len(skipped)}')
    if still:
        print('\n仍需人工处理:')
        for p, n in still:
            print(f'  {n:>3} 处  {p}')
    if skipped:
        print('\n跳过的:')
        for p, why in skipped:
            print(f'  {p}  ({why})')
    if not apply:
        print('\n（这是试运行，加 --apply 才会写入）')

main()
