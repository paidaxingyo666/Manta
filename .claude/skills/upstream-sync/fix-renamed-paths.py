#!/usr/bin/env python3
"""Point path strings at the files the mirror renamed.

The mirror renames upstream's new orcad-*/orca-* files to their Manta names, but a
reference whose own token has no Manta twin yet (an import of a brand-new module,
a workflow path filter) keeps the old spelling. A string is rewritten only when the
path it names does not exist and its Manta spelling does. Run after the merge
commit, before sync-finish.sh; `--dry` lists what would change.
"""
import glob, os, re, subprocess, sys

DRY = '--dry' in sys.argv
SKIP = ('node_modules/', '.claude/skills/upstream-sync/', 'docs/release-notes/',
        'src/main/runtime/__fixtures__/', 'src/main/daemon/__fixtures__/', 'mobile/rpc-foundation/')
TRY = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.json', '/index.ts', '/index.tsx', '/index.js']
ROOTS = r'(?:\.{1,2}/|config/|src/|mobile/|scripts/|resources/|out/|native/|tests/)'
QUOTED = re.compile(r"""(['"`])(""" + ROOTS + r"""[^'"`\s$]*?[Oo]rca[^'"`\s$]*)\1""")
BARE = re.compile(r'(?<![\w/.-])(' + ROOTS + r'[\w./*-]*[Oo]rca[\w./-]*)')
CODE = ('.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.json')
SHELL = ('.yml', '.yaml', '.ps1', '.psm1', '.sh')


def rebrand(s):
    return s.replace('ORCA', 'MANTA').replace('Orca', 'Manta').replace('orca', 'manta')


def exists(base, p):
    full = os.path.normpath(os.path.join(base, p)) if p.startswith('.') else p
    if '*' in full:
        return bool(glob.glob(full))
    return any(os.path.exists(full + e) for e in TRY)


NAME = re.compile(r"""(['"`])([\w.-]*[Oo]rca[\w.-]*\.(?:cjs|mjs|js|ts|tsx|json|ps1|sh|nsh))\1""")


def main():
    files = subprocess.run(['git', 'ls-files', '-z'], capture_output=True).stdout.decode().split('\0')
    # A bare file name (`join(dir, 'orcad-x.cjs')`, `argv[1].endsWith('orcad-x.mjs')`) is judged
    # against every tracked basename: renamed only when no file has the old name and one has the new.
    names = {os.path.basename(f) for f in files}
    total = 0
    for f in files:
        if f.startswith(SKIP) or not f.endswith(CODE + SHELL):
            continue
        try:
            text = open(f, encoding='utf-8').read()
        except (OSError, UnicodeDecodeError):
            continue
        base, changed = os.path.dirname(f), []

        def fix(path):
            if exists(base, path) or not exists(base, rebrand(path)):
                return path
            changed.append(path)
            return rebrand(path)

        def fix_name(m):
            name = m.group(2)
            if name in names or rebrand(name) not in names:
                return m.group(0)
            changed.append(name)
            return m.group(1) + rebrand(name) + m.group(1)

        if f.endswith(CODE):
            new = QUOTED.sub(lambda m: m.group(1) + fix(m.group(2)) + m.group(1), text)
            new = NAME.sub(fix_name, new)
        else:
            new = BARE.sub(lambda m: fix(m.group(1)), text)
        if new != text:
            total += len(changed)
            print(f, '|', ', '.join(sorted(set(changed)))[:200])
            if not DRY:
                open(f, 'w', encoding='utf-8').write(new)
    print('rewritten' if not DRY else 'would rewrite', total)


if __name__ == '__main__':
    main()
