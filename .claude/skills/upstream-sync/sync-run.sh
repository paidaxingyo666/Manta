#!/usr/bin/env bash
# Drive the cherry-pick, letting rebrand-merge.py absorb the brand-shaped
# conflicts and stopping the moment something needs a person.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# Hooks off for the duration. lint-staged reformats what it is given, and a
# sync must land upstream's bytes, not a locally reformatted version of them —
# the gates at the end are where formatting gets settled.
export HUSKY=0
git config core.hooksPath /dev/null
PICKS="${1:?usage: sync-run.sh <file-of-commit-shas>}"
LOG="${2:-/tmp/sync-status.txt}"
: > "$LOG"
total=$(grep -c . "$PICKS")
n=0
while read -r c; do
  [ -z "$c" ] && continue
  n=$((n + 1))
  subj=$(git log -1 --format=%s "$c")
  printf '[%d/%d] %s %s\n' "$n" "$total" "${c:0:10}" "${subj:0:70}"
  if git cherry-pick -x "$c" >/dev/null 2>&1; then
    echo "OK       $c  $subj" >> "$LOG"
    continue
  fi
  # Empty picks are the common case here: upstream rewrote history, so some of
  # what looks missing is already in the tree under a different SHA.
  if [ -z "$(git diff --name-only --diff-filter=U)" ]; then
    if git cherry-pick --skip >/dev/null 2>&1; then
      echo "EMPTY    $c  $subj" >> "$LOG"
      continue
    fi
  fi
  python3 "$HERE/rebrand-merge.py" --apply > /tmp/rebrand-out.txt 2>&1
  if [ -z "$(git diff --name-only --diff-filter=U)" ]; then
    if git -c core.editor=true cherry-pick --continue >/dev/null 2>&1; then
      echo "REBRAND  $c  $subj" >> "$LOG"
      continue
    fi
    # Resolution can leave nothing to commit: the change was already in the
    # tree, or it only ever touched files this fork does not carry.
    if git cherry-pick --skip >/dev/null 2>&1; then
      echo "EMPTIED  $c  $subj" >> "$LOG"
      continue
    fi
  fi
  echo "STOP     $c  $subj" >> "$LOG"
  echo "--- 需要人工，剩余冲突 ---"
  git diff --name-only --diff-filter=U
  cat /tmp/rebrand-out.txt
  exit 1
done < "$PICKS"
git config --unset core.hooksPath
echo "全部完成"
