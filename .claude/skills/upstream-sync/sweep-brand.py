#!/usr/bin/env python3
"""Rebrand what the clean picks brought in — but only where a Manta name exists.

rebrand-merge.py only touches files git stopped on. A commit that applied
cleanly lands upstream's spelling verbatim — a new module named orcad, an import
of ./orca-runtime — and the build breaks on a path this fork renamed long ago.

The rule is evidence, not enthusiasm: a token is renamed only when its Manta
counterpart already exists somewhere in the tree. That keeps the deliberate
remnants (upstream's repo slug, GNOME Orca, the five backwards-compatible skill
aliases) without having to enumerate them, because none of them has a Manta
twin. Everything it declines to touch is printed, because that list is where the
next decision lives.

Usage:  sweep-brand.py <since-rev> [--apply]
"""
import re, subprocess, sys, pathlib, functools

TOKEN = re.compile(r'[A-Za-z0-9_.@/-]*(?:[Oo]rca|ORCA)[A-Za-z0-9_.@/-]*')

# Deliberate remnants that DO have a Manta twin, so the evidence rule alone
# would rename them. Each is load-bearing exactly as spelled:
#   - upstream's repo slug guards workflows this fork must never run
#   - the five skill aliases keep already-installed skills resolvable
#   - GNOME Orca is Ubuntu's screen reader, and the reason the Linux binary is
#     called manta-ide rather than manta
KEEP = {
    'stablyai/orca',
    'github.com/stablyai/orca',
    'orca-cli',
    'orca-emulator',
    'orca-emulator-android',
    'orca-linear',
    'orca-per-workspace-env',
    'orca-hourly-release',
    'onorca-cloud',
}
KEEP_SUBSTRING = ('stablyai/orca', 'GNOME Orca', '/usr/bin/orca', 'onorca-cloud')

def rebrand_token(tok):
    return tok.replace('ORCA', 'MANTA').replace('Orca', 'Manta').replace('orca', 'manta')

def run(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout

@functools.lru_cache(maxsize=None)
def manta_twin_exists(token):
    """Does this fork already speak the Manta form of this token, as a token?

    Whole-word, not substring: `mantad` turns up inside unrelated identifiers,
    and a substring hit is not evidence that the fork uses that name.
    """
    if token in KEEP or any(k in token for k in KEEP_SUBSTRING):
        return False
    twin = rebrand_token(token)
    if twin == token:
        return False
    # The token often carries a path prefix (`../runtime/orca-runtime-browser`)
    # that no import in this tree spells the same way. The basename is what
    # identifies the module, so ask about that too.
    for candidate in (twin, twin.rsplit('/', 1)[-1]):
        hit = subprocess.run(['git', 'grep', '-q', '-w', '-F', candidate, 'HEAD'], capture_output=True)
        if hit.returncode == 0:
            return True
    return False

def main():
    since = sys.argv[1]
    apply = '--apply' in sys.argv
    changed = [p for p in run('git', 'diff', '--name-only', f'{since}..HEAD').splitlines() if p]

    renamed, declined = {}, {}
    for path in changed:
        p = pathlib.Path(path)
        if not p.exists() or p.is_dir():
            continue
        try:
            text = p.read_text()
        except (UnicodeDecodeError, IsADirectoryError):
            continue

        def replace(m):
            tok = m.group(0)
            if manta_twin_exists(tok):
                renamed.setdefault(path, set()).add(tok)
                return rebrand_token(tok)
            # Two brand-bearing names can sit flush against each other —
            # `__ORCA_AGENT_PATH__orca-fake-cli` is a sentinel this fork renamed
            # glued to a fixture name it did not. Judge the halves separately.
            if '__' in tok:
                parts = tok.split('__')
                if any(manta_twin_exists(f'__{q}__') for q in parts if q):
                    out = '__'.join(
                        rebrand_token(q) if manta_twin_exists(f'__{q}__') else q for q in parts)
                    if out != tok:
                        renamed.setdefault(path, set()).add(tok)
                        return out
            declined.setdefault(tok, set()).add(path)
            return tok

        new = TOKEN.sub(replace, text)
        new = re.sub(r'\ban Manta\b', 'a Manta', new)
        new = re.sub(r'\bAn Manta\b', 'A Manta', new)
        if new != text and apply:
            p.write_text(new)

    print(f'改名: {len(renamed)} 个文件')
    for path, toks in sorted(renamed.items()):
        print(f'  {path}')
        print(f'      {", ".join(sorted(toks))[:150]}')
    print(f'\n未改名（找不到 Manta 对应，需人工确认）: {len(declined)} 个 token')
    for tok, paths in sorted(declined.items()):
        print(f'  {tok:<44} {len(paths)} 个文件  例: {sorted(paths)[0]}')
    if not apply:
        print('\n（试运行，加 --apply 才会写入）')

main()
