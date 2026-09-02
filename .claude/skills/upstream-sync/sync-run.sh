#!/usr/bin/env bash
# Sync from upstream: rebuild the mirror, rebase the fork's commits onto it.
#
#   sync-run.sh [--fork main] [--upstream upstream/main] [--branch sync/upstream-YYYYMMDD]
#
# What it does, and why in this order:
#   1. fetch upstream, and stop if refs/sync/base already mirrors its tip
#   2. build refs/sync/mirror — upstream speaking Manta, evidence = the fork
#   3. cut the work branch from the fork and rebase it:
#        git rebase --onto refs/sync/mirror refs/sync/base <branch>
#      With both sides speaking Manta, every conflict is a real one: the same
#      code changed on both sides. The rename can no longer conflict, and a
#      file upstream deleted cannot come back by accident — the fork's edit to
#      it stops the rebase as modify/delete and someone decides.
#   4. on a clean rebase, hand off to sync-finish.sh; on conflicts, print what
#      to do and exit 1. Resolve, `git rebase --continue`, then run
#      sync-finish.sh yourself.
#
# Never run this on main. It writes refs/sync/mirror and the work branch only.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
FORK=main; UPSTREAM=upstream/main; BRANCH="sync/upstream-$(date +%Y%m%d)"
while [ $# -gt 0 ]; do
  case "$1" in
    --fork) FORK="$2"; shift 2 ;;
    --upstream) UPSTREAM="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "working tree not clean" >&2; exit 1; }
BASE="$(git rev-parse --verify refs/sync/base 2>/dev/null)" || { echo "refs/sync/base missing — run sync-bootstrap.sh first" >&2; exit 1; }

echo "== 1/4 fetch $UPSTREAM"
git fetch -q upstream
UP="$(git rev-parse "$UPSTREAM")"
BASE_UP="$(git log -1 --format=%B "$BASE" | sed -n 's/^Mirror-Of: //p' | tail -1)"
if [ "$UP" = "$BASE_UP" ]; then
  echo "   already at upstream ${UP:0:12}; nothing to sync"; exit 0
fi
echo "   base mirrors ${BASE_UP:0:12}; upstream is at ${UP:0:12} ($(git rev-list --count "$BASE_UP..$UP" 2>/dev/null || echo '?') new commits)"

echo "== 2/4 build mirror (evidence = $FORK)"
python3 "$HERE/build-mirror.py" --upstream "$UPSTREAM" --evidence "$FORK" --ref refs/sync/mirror 2>&1 | grep -vE '^\s+[0-9]+/[0-9]+ commits' | sed 's/^/  /'
MIRROR="$(git rev-parse refs/sync/mirror)"

echo "== 3/4 rebase $FORK → $BRANCH onto mirror ${MIRROR:0:12}"
# Merge drivers for the files that must not be merged line by line. Local
# config: the driver names are committed in .gitattributes, the commands are not.
git config merge.keepfork.name "keep the fork's version"
git config merge.keepfork.driver 'cp %B %A'
git config merge.keepupstream.name "keep upstream's version, regenerate afterwards"
git config merge.keepupstream.driver 'true'
git branch -f "$BRANCH" "$FORK"
git checkout -q "$BRANCH"
if git -c core.hooksPath=/dev/null -c merge.directoryRenames=false rebase -q --onto refs/sync/mirror "$BASE" "$BRANCH" 2>/tmp/sync-rebase.err; then
  echo "   clean"
  echo "== 4/4 finish"
  exec "$HERE/sync-finish.sh"
fi

echo
echo "   rebase stopped. Conflicts:"
git diff --name-only --diff-filter=U | sed 's/^/     /'
echo
cat <<'EOF'
   How to read them:
     mobile/**/*.tsx, *.ts      usually the fork's translate() wrapper against an
                                upstream edit to the same line. Take upstream's
                                side and re-localize afterwards:
                                  git checkout --ours -- <file>; git add <file>
                                sync-finish.sh runs the localizer over mobile/.
     modify/delete              upstream deleted a file the fork edited. If the
                                fork's edit was a fix upstream has since absorbed,
                                take the deletion: git rm <file>. If it is fork
                                feature, move the edit to wherever upstream put
                                that code, then git rm the old path.
     anything else              a genuine two-sided change. Resolve by hand.
   (--ours is upstream during a rebase; --theirs is the fork's commit.)

   Then:  git rebase --continue   and when it ends:  .claude/skills/upstream-sync/sync-finish.sh
EOF
exit 1
