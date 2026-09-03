#!/usr/bin/env python3
"""Make pnpm-lock.yaml's patch hashes match the patch files on disk.

pnpm records a sha256 of every file in `patchedDependencies`, so a sync that
brings a changed patch leaves the lockfile disagreeing with the tree and
`--frozen-lockfile` refuses it. Recomputing beats re-resolving: resolution can
fail for reasons unrelated to the sync (a pin unpublished from the registry, a
supply-chain policy), and the dependency graph has not changed — only the bytes
of a patch the graph already references.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                                   capture_output=True, text=True).stdout.strip())
ws, lock = root / 'pnpm-workspace.yaml', root / 'pnpm-lock.yaml'
if not ws.exists() or not lock.exists():
    sys.exit(0)

section = re.search(r'^patchedDependencies:\n((?:  .*\n)+)', ws.read_text(), re.M)
if not section:
    print('no patchedDependencies'); sys.exit(0)
patches = dict(re.findall(r"^\s+'?([^':]+(?::[^']*)?)'?:\s*(\S+)\s*$", section.group(1), re.M))

text, changed = lock.read_text(), []
for dep, rel in patches.items():
    dep, path = dep.strip("'"), root / rel
    if not path.exists():
        print(f'! {dep}: {rel} missing'); continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    pattern = re.compile(rf"(^\s+'?{re.escape(dep)}'?:\s*)([0-9a-f]{{64}})\s*$", re.M)
    new_text, n = pattern.subn(lambda m: m.group(1) + digest, text)
    if n and new_text != text:
        changed.append(dep)
    text = new_text
if changed:
    lock.write_text(text)
    print(f'refreshed {len(changed)}: ' + ', '.join(changed))
else:
    print('all patch hashes already match')
