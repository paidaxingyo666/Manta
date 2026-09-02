#!/usr/bin/env bash
# The whole verification of a sync, in the only order that works. Run it after
# the picks land and before opening the PR; run it again after every repair.
#
# Every step here exists because its absence let something through:
#   1. sweep-brand first — a clean pick lands upstream's spelling verbatim, and
#      running the sweep last means re-running everything after it.
#   2. resurrection audit — a modify/delete conflict "resolved" by keeping the
#      file brings back what upstream deleted; a 1400-line one carried the
#      max-lines suppression the ratchet then failed on.
#   3. regenerate every generated artifact — skill manifest, max-lines baseline,
#      the localizer — or the gates fail on stale bytes.
#   4. root gates, ALL of them: `pnpm lint` is fifteen commands and oxlint is
#      the first; when it exits non-zero the other fourteen never run.
#   5. mobile gates, separately: mobile has its own oxlint, oxfmt config and
#      lockfile, and the root commands touch none of them.
#
# Exit non-zero on the first failure and say which step. Nothing here commits.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
SINCE="${1:-main}"
FAIL=0
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1"; FAIL=1; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }

step "1/7 brand sweep (report only)"
# The mirror already speaks Manta, so nothing upstream brought in still needs
# renaming; what this finds is a fork file that lost its spelling, or a fixture
# path the evidence rule would rename for no gain. Read it; apply by hand.
python3 "$HERE/sweep-brand.py" "$SINCE" | tee /tmp/sync-sweep.txt | head -3
if grep -q '^改名: [1-9]' /tmp/sync-sweep.txt; then
  printf '  candidates above — see /tmp/sync-sweep.txt. Apply only what is a real regression.\n'
fi

step "2/7 resurrection audit"
# Files upstream deleted at some point in the mirror's history that are still
# in this tree. Under a rebase that can only happen through a modify/delete
# conflict someone resolved by keeping the file — which is sometimes right
# (fork feature) and must then be said so in the PR.
if git rev-parse -q --verify refs/sync/mirror >/dev/null 2>&1; then
  python3 - <<'PY' || FAIL=1
import subprocess, pathlib
def git(*a): return subprocess.run(['git', *a], capture_output=True, text=True).stdout
deleted = set(git('log', '--diff-filter=D', '--name-only', '--format=', 'refs/sync/mirror').split('\n')) - {''}
present = set(git('ls-tree', '-r', '--name-only', 'refs/sync/mirror').split('\n'))
gone = deleted - present                      # deleted and never re-added upstream
alive = sorted(p for p in gone if pathlib.Path(p).exists())
if alive:
    print(f'✗ {len(alive)} file(s) upstream deleted are still in the tree:')
    for p in alive: print(f'    {p}')
    print('  Each is either a resurrection (delete it) or a deliberate fork keep (say so in the PR).')
    raise SystemExit(1)
print(f'✓ none of the {len(gone)} paths upstream deleted survive here')
PY
else
  printf '  no refs/sync/mirror — skipped (cherry-pick era tree)\n'
fi

step "3/7 twin audit"
# orca-X and manta-X side by side is a rename that landed as a copy.
twins=$(git ls-files | grep -iE '(^|/)orca[-_]' | while read -r f; do
  m="$(echo "$f" | sed -E 's/(^|\/)orca([-_])/\1manta\2/')"
  [ -e "$m" ] && echo "$f  ↔  $m"; done)
if [ -n "$twins" ]; then fail "orca-/manta- twins present:"; echo "$twins" | sed 's/^/    /'; else ok "no orca-/manta- twins"; fi

step "4/7 regenerate generated artifacts"
pnpm run -s generate:skill-bundle-manifest >/dev/null 2>&1 && ok "skill bundle manifest" || fail "generate:skill-bundle-manifest"
# Mobile only. The root localizer wraps strings in test fixtures too; the root
# coverage gate inside `pnpm lint` is the check there, and localizing is a
# decision someone makes on purpose.
node "$ROOT/config/scripts/localize-renderer-strings.mjs" --target mobile 2>&1 | tail -1 | sed 's/^/  /'
python3 - <<'PY' || fail "zh.json is missing keys en.json has — translate them before continuing"
import json
en = json.load(open('mobile/src/i18n/locales/en.json')); zh = json.load(open('mobile/src/i18n/locales/zh.json'))
miss = []
def walk(e, z, path):
    for k, v in e.items():
        if isinstance(v, dict): walk(v, z.get(k, {}) if isinstance(z, dict) else {}, path + [k])
        elif not isinstance(z, dict) or k not in z: miss.append('.'.join(path + [k]))
walk(en, zh, [])
if miss:
    print(f'  {len(miss)} key(s) untranslated:'); [print(f'    {m}') for m in miss[:30]]
    raise SystemExit(1)
print('  zh.json covers every en.json key')
PY
if [ -n "$(git status --porcelain resources/skills mobile/src/i18n src/renderer/src/i18n 2>/dev/null)" ]; then
  printf '  regenerated artifacts changed — commit them with the sync.\n'
fi

step "5/7 root gates"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "pnpm install --frozen-lockfile" || fail "root lockfile is out of date (pnpm install --lockfile-only)"
pnpm tc >/tmp/sync-tc.log 2>&1 && ok "pnpm tc" || { fail "pnpm tc — $(grep -c 'error TS' /tmp/sync-tc.log) error(s), see /tmp/sync-tc.log"; }
pnpm lint >/tmp/sync-lint.log 2>&1 && ok "pnpm lint (all 15 gates)" || { fail "pnpm lint — see /tmp/sync-lint.log"; grep -E ': error |newly bypass|unlocalized' /tmp/sync-lint.log | head -8 | sed 's/^/    /'; }
npx oxfmt --check $(git diff --name-only "$SINCE"...HEAD -- src config tests | grep -E '\.(ts|tsx|mjs|js)$' | while read -r f; do [ -f "$f" ] && echo "$f"; done) >/tmp/sync-fmt.log 2>&1 \
  && ok "oxfmt --check (files this sync touched)" || fail "oxfmt — run oxfmt on the files in /tmp/sync-fmt.log, NOT \`pnpm format\`"

step "6/7 mobile gates"
( cd mobile \
  && { pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "mobile lockfile" || fail "mobile lockfile is out of date (cd mobile && pnpm install --lockfile-only)"; } \
  && { npx oxlint >/tmp/sync-m-lint.log 2>&1 && ok "mobile oxlint" || { fail "mobile oxlint"; tail -3 /tmp/sync-m-lint.log | sed 's/^/    /'; }; } \
  && { npx oxfmt --check . >/dev/null 2>&1 && ok "mobile oxfmt" || fail "mobile oxfmt — run \`npx oxfmt .\` inside mobile/"; } \
  && { npx tsc --noEmit -p tsconfig.json >/tmp/sync-m-tc.log 2>&1 && ok "mobile typecheck" || fail "mobile typecheck — $(grep -c 'error TS' /tmp/sync-m-tc.log) error(s)"; } \
  && { npx vitest run >/tmp/sync-m-test.log 2>&1 && ok "mobile tests" || { fail "mobile tests"; grep -E '^ FAIL' /tmp/sync-m-test.log | head -5 | sed 's/^/    /'; }; } )

step "7/7 root tests"
printf '  full suite, project config. Re-run any failure serially before believing it — the .electron ones time out under load.\n'
pnpm test >/tmp/sync-test.log 2>&1 && ok "pnpm test" || { fail "pnpm test"; grep -E 'Test Files|Tests ' /tmp/sync-test.log | tail -2 | sed 's/^/    /'; grep -E '^ FAIL' /tmp/sync-test.log | sed 's/.*FAIL *//' | cut -d'>' -f1 | sort -u | head -20 | sed 's/^/    /'; }

printf '\n'
if [ "$FAIL" -ne 0 ]; then printf '\033[31mSYNC NOT READY\033[0m — fix the ✗ lines above and run again.\n'; exit 1; fi
printf '\033[32mSYNC VERIFIED\033[0m — open the PR, wait for Mobile Checks, merge without squash.\n'
