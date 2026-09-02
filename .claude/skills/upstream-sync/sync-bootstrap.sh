#!/usr/bin/env bash
# One-time: move the fork onto the mirror.
#
# Produces a branch whose history is `refs/sync/mirror` (upstream, speaking
# Manta) plus one commit carrying everything this fork actually changed. From
# then on a sync is `sync-run.sh`: rebuild the mirror, rebase the fork's commits
# onto it, verify.
#
#   sync-bootstrap.sh <fork-ref> [<new-branch>]
#
# <fork-ref> is the fork as it stands (main, or the sync branch about to land).
# The new branch defaults to sync/mirror-bootstrap. Nothing here touches main,
# and the mirror must already exist (build-mirror.py --evidence <fork-ref>).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
FORK="${1:?usage: sync-bootstrap.sh <fork-ref> [<new-branch>]}"
BRANCH="${2:-sync/mirror-bootstrap}"
# MIRROR_REF / BASE_REF: overridable so sync-selftest.sh can replay a sync on
# throwaway refs without touching the real ones.
MIRROR_REF="${MIRROR_REF:-refs/sync/mirror}"; BASE_REF="${BASE_REF:-refs/sync/base}"
MIRROR="$(git rev-parse --verify "$MIRROR_REF" 2>/dev/null || { echo "$MIRROR_REF missing — run build-mirror.py first" >&2; exit 1; })"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "working tree not clean" >&2; exit 1; }

echo "== mirror $MIRROR  fork $(git rev-parse --short "$FORK")  → $BRANCH"
git branch -f "$BRANCH" "$MIRROR"
git checkout -q "$BRANCH"

# 1. The fork's tree, over the mirror's. Overwrites and adds; deletes nothing.
git checkout -q "$FORK" -- .

# 2. Mirror-only paths — files upstream has and the fork does not. Three kinds:
#      - the fork's own history deleted it on purpose (the README translations
#        and demo media it does not maintain): stay deleted.
#      - a code file nothing in the tree imports: a parallel split, where
#        upstream carved a component into a new file and the fork had already
#        replaced that component with its own localized one. Dead here, and
#        it drags untranslated strings and unformatted code along: drop it.
#      - everything else (upstream's docs site, workflows gated on their repo
#        slug): keep. Dead weight, but it can never conflict.
#    "We never received the commit that added it" and "we dropped it" look the
#    same in a tree diff; only a deletion in our history, or nothing importing
#    it, may delete.
# --no-renames: git would otherwise pair upstream's parallel split with the
# fork's file of the same name under another path and report a rename, not an
# addition, and the orphan check would never see it.
git diff --name-only --no-renames --diff-filter=A "$FORK" "$MIRROR" -- . > /tmp/sync-mirror-only.txt
while read -r p; do
  [ -z "$p" ] && continue
  if git log --diff-filter=D --format=%h -1 "$FORK" -- "$p" | grep -q .; then
    git rm -q --ignore-unmatch -- "$p"; echo "  dropped (fork deleted it before): $p"
  fi
done < /tmp/sync-mirror-only.txt
# Orphans, by resolving every relative import in the app's source trees to a
# real path. A basename match is not enough: ../src/pair-scan-styles and
# ../src/theme/pair-scan-styles share one, and only the second exists here.
# Scoped to src/ and mobile/ — a self-contained subproject (docs/site) imports
# nothing from them and is kept whole.
python3 "$HERE/orphan-imports.py" /tmp/sync-mirror-only.txt | while read -r p; do
  git rm -q --ignore-unmatch -- "$p"; echo "  dropped (nothing imports it): $p"
done

# The tree is now the fork's, minus the drops above — nothing else changes.
# Content cleanups (the `stablyai/manta` slug the original rebrand produced,
# for one) are separate, reviewed commits: normalize-slug.py does the safe
# subset. A bootstrap that also edits content cannot be checked against the
# fork it came from.

git add -A
git -c core.hooksPath=/dev/null commit -q -F - <<MSG
fork: Manta customizations

Bootstrapped from $(git rev-parse --short "$FORK") onto the mirror of upstream
at $(git rev-parse --short "$MIRROR"). Everything this fork changed inside
upstream's files, and everything it owns outright — the self-hosted relay, the
mobile localization, its release CI, its branding beyond the token rename —
in one commit, so a sync can rebase it as one unit onto the next mirror.

Mirror-Base: $MIRROR
Fork-Source: $(git rev-parse "$FORK")
MSG
git update-ref "$BASE_REF" "$MIRROR"
echo "== $BRANCH = $(git rev-parse --short HEAD)   $BASE_REF = ${MIRROR:0:12}"
echo
git diff --shortstat "$MIRROR" HEAD | sed 's/^/  fork patch: /'
echo
echo "Next: .claude/skills/upstream-sync/sync-verify.sh $MIRROR"
