#!/usr/bin/env python3
"""Print the candidate source files that nothing in the app imports.

  orphan-imports.py <file-listing-candidate-paths>

Resolves every relative import under src/, mobile/src and mobile/app to a real
path and reports the candidates none of them reach. A basename match would not
do: `../src/pair-scan-styles` and `../src/theme/pair-scan-styles` share one,
and only the second exists in this fork — the first is upstream's parallel
split of a component the fork had already replaced with its own.

Only src/ and mobile/ candidates are considered; a self-contained subproject
such as docs/site imports nothing from them and must be kept or dropped whole.
"""
import os
import pathlib
import re
import sys

IMP = re.compile(r"""(?:from|import|require\(|import\()\s*['"](\.[^'"]+)['"]""")
ROOTS = ('src', 'mobile/src', 'mobile/app')


def main(listing):
    cands = {p for p in open(listing).read().split()
             if re.match(r'(src|mobile/src|mobile/app)/.*\.(ts|tsx)$', p) and pathlib.Path(p).exists()}
    if not cands:
        return
    referenced = set()
    for root in ROOTS:
        for f in pathlib.Path(root).rglob('*'):
            if f.suffix not in ('.ts', '.tsx', '.mjs', '.js') or 'node_modules' in f.parts:
                continue
            try:
                text = f.read_text()
            except (UnicodeDecodeError, OSError):
                continue
            for m in IMP.finditer(text):
                target = os.path.normpath(os.path.join(f.parent, m.group(1)))
                for ext in ('', '.ts', '.tsx', '/index.ts', '/index.tsx'):
                    if target + ext in cands:
                        referenced.add(target + ext)
    for p in sorted(cands - referenced):
        print(p)


if __name__ == '__main__':
    main(sys.argv[1])
