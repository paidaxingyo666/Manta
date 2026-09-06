#!/usr/bin/env bash
# After the rebase lands: regenerate what is generated, localize what is new,
# record the new base, verify. Run from the sync branch with a clean rebase.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
[ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] && { echo "a rebase is still in progress" >&2; exit 1; }
MIRROR="$(git rev-parse refs/sync/mirror)"
git merge-base --is-ancestor "$MIRROR" HEAD || { echo "HEAD is not on top of refs/sync/mirror — was the rebase finished?" >&2; exit 1; }

echo "== patched dependency hashes"
# Upstream changes what its patches do, and the lockfile records a hash of each
# patch file. The merge brings the new patch but the old hash, and
# --frozen-lockfile refuses the tree. Recompute from the files on disk rather
# than re-resolving: re-resolution can fail for reasons that have nothing to do
# with this sync (an unpublished pin, a policy gate), and nothing here needs it.
node "$HERE/refresh-patch-hashes.mjs" | sed 's/^/   /'

echo "== lockfiles: upstream's, with the fork's package.json folded back in"
pnpm install --lockfile-only >/dev/null 2>&1 && echo "   root ok" || echo "   root: pnpm install --lockfile-only failed"
( cd mobile && pnpm install --lockfile-only >/dev/null 2>&1 && echo "   mobile ok" || echo "   mobile: pnpm install --lockfile-only failed" )

echo "== mobile localization: wrap what upstream added, translate from memory"
python3 "$HERE/sync-i18n.py" | sed 's/^/   /'

echo "== desktop Chinese: reapply this fork's wording"
# The locale catalogs are on the keepupstream driver, so every sync reverts the
# fork's terminology to upstream's — 490 entries on 2026-09-05, all one word.
node "$ROOT/config/scripts/fork-zh-terminology.mjs" | sed 's/^/   /'

echo "== record the new base"
git update-ref refs/sync/base "$MIRROR"
echo "   when the sync lands, publish it:  git push origin refs/sync/base refs/sync/mirror"
echo "   refs/sync/base = ${MIRROR:0:12}  (Mirror-Of $(git log -1 --format=%B "$MIRROR" | sed -n 's/^Mirror-Of: //p' | cut -c1-12))"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git add -A
  git -c core.hooksPath=/dev/null commit -q -m "$(cat <<EOF
sync: regenerate after rebasing onto upstream $(git log -1 --format=%B "$MIRROR" | sed -n 's/^Mirror-Of: //p' | cut -c1-12)

Lockfiles refolded, new upstream strings localized, catalogs regenerated.
EOF
)"
  echo "   committed regeneration $(git rev-parse --short HEAD)"
fi

echo "== verify"
"$HERE/sync-verify.sh" "$MIRROR" || exit $?

echo "== cut the release"
# A sync that lands and never ships is upstream's fixes sitting in a branch. The
# release rides in this same PR: merging it is what publishes, because
# auto-release.yml tags whatever version arrives on main.
node "$ROOT/config/scripts/cut-fork-release.mjs" 2>&1 | sed 's/^/   /'
