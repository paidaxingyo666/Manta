#!/usr/bin/env python3
"""Mobile localization after a sync: wrap upstream's new strings, translate
from memory, say what is left.

The fork's `translate()` wrappers rebase along with everything else, so keys
stay stable across syncs; only strings upstream added since the last one are
new. The localizer wraps those and writes their English. This script then fills
`zh.json` from a translation memory keyed by English text — a string upstream
moved or duplicated keeps its translation — and prints the genuinely new ones
for a person to translate. Nothing here invents a translation.

The memory lives in the tree so it accumulates:
  mobile/src/i18n/translation-memory.zh.json   { "English text": "中文" }
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True).stdout.strip())
EN = ROOT / 'mobile/src/i18n/locales/en.json'
ZH = ROOT / 'mobile/src/i18n/locales/zh.json'
TM = ROOT / 'mobile/src/i18n/translation-memory.zh.json'


def leaves(d, path=()):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from leaves(v, path + (k,))
        else:
            yield path + (k,), v


def get(d, path):
    for k in path:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def put(d, path, value):
    for k in path[:-1]:
        d = d.setdefault(k, {})
    d[path[-1]] = value


def load(p):
    return json.loads(p.read_text()) if p.exists() else {}


def dump(p, d):
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')


def main():
    en, zh = load(EN), load(ZH)
    tm = load(TM)

    # 1. Memory absorbs every pair the tree already has.
    before = len(tm)
    for path, text in leaves(en):
        z = get(zh, path)
        if isinstance(text, str) and isinstance(z, str) and z and z != text:
            tm.setdefault(text, z)
    if len(tm) != before:
        print(f'memory: +{len(tm) - before} pairs ({len(tm)} total)')

    # 2. Wrap what upstream added.
    out = subprocess.run(['node', 'config/scripts/localize-renderer-strings.mjs', '--target', 'mobile'],
                         capture_output=True, text=True, cwd=ROOT)
    print((out.stdout.strip().splitlines() or ['localizer: no output'])[-1])
    en = load(EN)

    # 3. Fill zh from memory; list the rest.
    filled, missing = 0, []
    for path, text in leaves(en):
        if get(zh, path) is not None:
            continue
        if isinstance(text, str) and text in tm:
            put(zh, path, tm[text]); filled += 1
        else:
            missing.append(('.'.join(path), text))
    dump(ZH, zh)
    dump(TM, tm)
    print(f'zh.json: {filled} filled from memory, {len(missing)} still English')
    for key, text in missing:
        print(f'  TODO  {key} = {text!r}')
    if missing:
        print('translate these in mobile/src/i18n/locales/zh.json before the PR; the coverage gate will hold until then')


if __name__ == '__main__':
    main()
