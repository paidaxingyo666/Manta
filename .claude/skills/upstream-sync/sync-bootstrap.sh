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
MIRROR="$(git rev-parse --verify refs/sync/mirror 2>/dev/null || { echo "refs/sync/mirror missing — run build-mirror.py first" >&2; exit 1; })"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "working tree not clean" >&2; exit 1; }

echo "== mirror $MIRROR  fork $(git rev-parse --short "$FORK")  → $BRANCH"
git branch -f "$BRANCH" "$MIRROR"
git checkout -q "$BRANCH"

# 1. The fork's tree, over the mirror's. Overwrites and adds; deletes nothing.
git checkout -q "$FORK" -- .

# 2. Mirror-only paths: keep upstream's file unless the fork's own history
#    deleted it on purpose. "We never received the commit that added it" and
#    "we dropped it" look the same in a tree diff; only the second may delete.
git diff --name-only --diff-filter=D "$FORK" "$MIRROR" -- . | while read -r p; do
  [ -z "$p" ] && continue
  if git log --diff-filter=D --format=%h -1 "$FORK" -- "$p" | grep -q .; then
    git rm -q --ignore-unmatch -- "$p"
    echo "  dropped (fork deleted it before): $p"
  fi
done

# 3. Normalize the one spelling the original rebrand got wrong in bulk.
#    `stablyai/manta` is a repository that does not exist: the blind pass
#    produced it from upstream's slug. In fixtures and tests any slug works, so
#    they take upstream's — which makes 182 files identical to the mirror and
#    stops them conflicting on every sync. The handful of real defaults point
#    at this fork.
python3 - <<'PY'
import subprocess, pathlib, re
# The slug is spelled from parts so this script never matches itself: it did
# once, rewrote its own search pattern into a no-op, and committed that.
SLUG = 'stablyai/' + 'manta'
files = subprocess.run(['git', 'grep', '-l', '-F', SLUG, '--', '.', ':!.claude/skills/upstream-sync'], capture_output=True, text=True).stdout.split()
real = re.compile(r'(publish-complete-draft-releases|setup-hourly-release-token|macos-launch-diagnostics|latest-stable-release|create-draft-release)\.(mjs|sh|cjs)$')
n_fix = n_real = 0
for f in files:
    p = pathlib.Path(f)
    if f.endswith('.json') and 'locale' in f:      # translations of the slug stay as data
        continue
    t = p.read_text()
    is_real = bool(real.search(f)) and not ('.test.' in f)
    new = t.replace(SLUG, 'paidaxingyo666/Manta' if is_real else 'stablyai/orca')
    if new != t:
        p.write_text(new)
        n_real += is_real; n_fix += (not is_real)
print(f'  slug normalized: {n_fix} fixture/test files → stablyai/orca, {n_real} real defaults → paidaxingyo666/Manta')
PY

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
git update-ref refs/sync/base "$MIRROR"
echo "== $BRANCH = $(git rev-parse --short HEAD)   refs/sync/base = ${MIRROR:0:12}"
echo
git diff --shortstat "$MIRROR" HEAD | sed 's/^/  fork patch: /'
echo
echo "Next: .claude/skills/upstream-sync/sync-verify.sh $MIRROR"
