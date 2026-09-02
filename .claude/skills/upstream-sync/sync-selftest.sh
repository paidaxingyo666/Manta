#!/usr/bin/env bash
# Prove the rebase-based sync on a known delta: replay a range of upstream
# commits the fork has already absorbed by hand, and diff the outcome against
# that hand-made result. Everything happens in a throwaway worktree on
# throwaway refs; the real refs/sync/* and the working tree are untouched.
#
#   sync-selftest.sh <fork-before> <fork-after> <upstream-from> <upstream-to>
#
#   fork-before   the fork as it was before the sync being replayed (a commit)
#   fork-after    the fork after that sync landed by hand (a commit)
#   upstream-from the upstream commit fork-before corresponds to
#   upstream-to   the upstream commit fork-after corresponds to
#
# Reports: how many files conflicted, of which kinds, and how far the replayed
# result is from the hand-made one. Conflicts are resolved by the documented
# rules where they apply (mobile → upstream + re-localize; lockfiles →
# upstream) and left for the report otherwise.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
BEFORE="$(git -C "$ROOT" rev-parse "${1:?fork-before}")"
AFTER="$(git -C "$ROOT" rev-parse "${2:?fork-after}")"
UP0="$(git -C "$ROOT" rev-parse "${3:?upstream-from}")"
UP1="$(git -C "$ROOT" rev-parse "${4:?upstream-to}")"
WT=/tmp/sync-selftest
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" branch -D selftest/work 2>/dev/null || true
git -C "$ROOT" worktree add -q --detach "$WT" "$BEFORE"
cd "$WT"
export MIRROR_REF=refs/sync/selftest-mirror BASE_REF=refs/sync/selftest-base

echo "== mirror of upstream-from ${UP0:0:12} (evidence: fork-before)"
python3 "$HERE/build-mirror.py" --upstream "$UP0" --evidence "$BEFORE" --ref refs/sync/selftest-mirror 2>&1 | grep -E 'commits ·|Manta twins' | sed 's/^/   /'
M0="$(git rev-parse refs/sync/selftest-mirror)"

echo "== bootstrap fork-before onto it"
"$HERE/sync-bootstrap.sh" "$BEFORE" selftest/work 2>&1 | grep -E '^==|fork patch' | sed 's/^/   /'

echo "== mirror of upstream-to ${UP1:0:12} (evidence: fork-before)"
python3 "$HERE/build-mirror.py" --upstream "$UP1" --evidence "$BEFORE" --ref refs/sync/selftest-mirror   # extends M0 2>&1 | grep -E 'commits ·|Manta twins' | sed 's/^/   /'
M1="$(git rev-parse refs/sync/selftest-mirror)"
echo "   $(git rev-list --count "$M0..$M1") upstream commits to cross"

echo "== merge the new mirror into the bootstrapped fork"
git config merge.keepfork.driver 'true'
git config merge.keepupstream.driver 'cp %B %A'
git checkout -q selftest/work
if git -c core.hooksPath=/dev/null -c merge.directoryRenames=false merge -q --no-ff --no-edit -m "selftest merge" "$M1" 2>/dev/null; then
  echo "   clean — no conflicts at all"
else
  conf="$(git diff --name-only --diff-filter=U)"
  n="$(printf '%s\n' "$conf" | grep -c .)"
  echo "   $n files conflicted:"
  printf '%s\n' "$conf" | awk -F/ '{print "     " ($1=="mobile"||$1=="src"||$1=="tests"||$1=="config" ? $1"/"$2 : $1)}' | sort | uniq -c | sort -rn | head -12
  # Documented resolutions. In a merge --theirs is upstream and --ours the fork.
  auto=0
  for f in $conf; do
    case "$f" in
      mobile/*.ts|mobile/*.tsx|pnpm-lock.yaml|mobile/pnpm-lock.yaml|resources/skills/*.json)
        git checkout --theirs -- "$f" 2>/dev/null && git add -- "$f" && auto=$((auto+1)) ;;
      README.md|docs/readme/README.zh-CN.md)
        git checkout --ours -- "$f" 2>/dev/null && git add -- "$f" && auto=$((auto+1)) ;;
      *)
        # modify/delete where the fork's history deleted it: stay deleted.
        if ! git cat-file -e ":3:$f" 2>/dev/null && git log --diff-filter=D --format=%h -1 "$BEFORE" -- "$f" | grep -q .; then
          git rm -q --cached -- "$f" 2>/dev/null; rm -f -- "$f"; auto=$((auto+1))
        fi ;;
    esac
  done
  left="$(git diff --name-only --diff-filter=U)"
  echo "   $auto resolved by rule; $(printf '%s\n' "$left" | grep -c .) need a person:"
  printf '%s\n' "$left" | head -30 | sed 's/^/     /'
  # For the report, take the fork's side of the rest so the merge can finish.
  for f in $left; do git checkout --ours -- "$f" 2>/dev/null; git add -- "$f"; done
  git -c core.hooksPath=/dev/null commit -q --no-edit -m "selftest merge" >/dev/null 2>&1 || true
fi

echo "== distance from the hand-made result ${AFTER:0:12}"
git diff --shortstat "$AFTER" HEAD | sed 's/^/   /'
git diff --name-status "$AFTER" HEAD | awk '{print $1}' | sort | uniq -c | sed 's/^/   /'
echo "   differing files by area:"
git diff --name-only "$AFTER" HEAD | awk -F/ '{print (($1=="mobile"||$1=="src")&&NF>2 ? $1"/"$2 : $1)}' | sort | uniq -c | sort -rn | head -10 | sed 's/^/     /'

cd "$ROOT"
git worktree remove --force "$WT"
git update-ref -d refs/sync/selftest-mirror; git update-ref -d refs/sync/selftest-base
if [ "${KEEP:-}" = "1" ]; then
  echo "== kept selftest/work for inspection (KEEP=1)"
else
  git branch -D selftest/work >/dev/null 2>&1
  echo "== cleaned up"
fi
