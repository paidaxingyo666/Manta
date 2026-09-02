#!/usr/bin/env bash
# One time: make the mirror-based branch the new main.
#
#   sync-cutover.sh [<bootstrapped-branch>]      default sync/mirror-bootstrap
#
# main's history changes — the fork's own commits now sit on the mirror instead
# of on a cherry-picked replay of upstream. The content is the same tree
# (sync-bootstrap.sh copies it and sync-verify.sh has run on it). The old main
# is kept as main-legacy. Branch protection blocks force pushes, so it is
# lifted for the one push and restored.
#
# Run it only when you mean it. Every open branch based on the old main must
# then be rebased: git rebase --onto main main-legacy <branch>
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
NEW="${1:-sync/mirror-bootstrap}"
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
git rev-parse --verify "$NEW" >/dev/null
git rev-parse --verify refs/sync/base >/dev/null || { echo "refs/sync/base missing" >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "working tree not clean" >&2; exit 1; }

echo "== $NEW ($(git rev-parse --short "$NEW")) will become main; main ($(git rev-parse --short main)) becomes main-legacy"
echo "   tree difference main → $NEW:"
git diff --shortstat main "$NEW" | sed 's/^/     /'
read -r -p "   type 'cutover' to continue: " ans
[ "$ans" = "cutover" ] || { echo "   aborted"; exit 1; }

git branch -f main-legacy main
git push -q origin main-legacy
echo "   main-legacy pushed"

protect() {
  gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<JSON
{
  "required_status_checks": { "strict": false, "contexts": ["verify", "Mobile Checks"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": $1,
  "allow_deletions": false
}
JSON
}
protect true
trap 'protect false; echo "   force pushes disallowed again"' EXIT

git branch -f main "$NEW"
git push --force-with-lease=main origin main
echo "   main is now $(git rev-parse --short main)"
git push -q origin refs/sync/base refs/sync/mirror
echo "   refs/sync/base and refs/sync/mirror published"
echo
echo "== done. Next sync: .claude/skills/upstream-sync/sync-run.sh"
