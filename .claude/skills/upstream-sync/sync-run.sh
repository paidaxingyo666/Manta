#!/usr/bin/env bash
# Drive the cherry-pick, letting rebrand-merge.py absorb the brand-shaped
# conflicts and stopping the moment something needs a person.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# Hooks off for the duration. lint-staged reformats what it is given, and a
# sync must land upstream's bytes, not a locally reformatted version of them —
# the gates at the end are where formatting gets settled.
export HUSKY=0
PRIOR_HOOKS_PATH="$(git config --get core.hooksPath || true)"
restore_hooks() {
  if [ -n "$PRIOR_HOOKS_PATH" ]; then
    git config core.hooksPath "$PRIOR_HOOKS_PATH"
  else
    git config --unset core.hooksPath 2>/dev/null || true
  fi
}
# Every exit, not just the happy one: this script stops on purpose whenever a
# conflict needs a person, and leaving hooks pointed at /dev/null would make
# every later commit skip pre-commit without saying so.
trap restore_hooks EXIT
git config core.hooksPath /dev/null
PICKS="${1:?usage: sync-run.sh <file-of-commit-shas>}"
LOG="${2:-/tmp/sync-status.txt}"
: > "$LOG"
total=$(grep -c . "$PICKS")
n=0
# `|| [ -n "$c" ]`: a list written without a trailing newline loses its last
# entry to a bare `read`, and the loop still reports success. It happened on the
# 23 August sync — the newest upstream commit was missing and only turned up
# because someone counted.
while read -r c || [ -n "$c" ]; do
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
echo "全部完成"
