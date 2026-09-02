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
import re, subprocess, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from brand_rule import rebrand_text, keep_whole_file, Evidence, TOKEN  # noqa: E402

def run(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout

def main():
    since = sys.argv[1]
    apply = '--apply' in sys.argv
    changed = [p for p in run('git', 'diff', '--name-only', f'{since}..HEAD').splitlines() if p]
    # This skill's own prose is *about* upstream, so renaming Orca inside it
    # inverts what it says — `orcad` became "upstream's new daemon named mantad".
    changed = [p for p in changed if not keep_whole_file(p)]

    # One evidence pass for every token in every changed file, instead of a
    # `git grep` per token; the same rule build-mirror.py applies.
    texts = {}
    for path in changed:
        p = pathlib.Path(path)
        if p.exists() and p.is_file():
            try:
                texts[path] = p.read_text()
            except UnicodeDecodeError:
                pass
    tokens = {m.group(0) for text in texts.values() for m in TOKEN.finditer(text)}
    evidence = Evidence('HEAD', tokens) if tokens else None

    renamed, declined = {}, {}
    for path in changed:
        p = pathlib.Path(path)
        if not p.exists() or p.is_dir():
            continue
        try:
            text = p.read_text()
        except (UnicodeDecodeError, IsADirectoryError):
            continue

        new, toks, decl = rebrand_text(text, evidence=evidence)
        if toks:
            renamed[path] = toks
        for tok in decl:
            declined.setdefault(tok, set()).add(path)
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
