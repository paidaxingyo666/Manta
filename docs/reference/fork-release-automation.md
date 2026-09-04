# Cutting and publishing a fork release

Upstream ships `1.4.196`; this fork ships `1.4.196-rc.N` once it has merged that
work. The mobile app has its own line — upstream ships `mobile-android-v0.0.47`,
this fork follows to `0.0.47`. Neither happens on its own, and a sync that lands
without a release is upstream's fixes sitting in a branch nobody can install.

## The path

```
sync branch ──► chore(release): cut …  ──► PR ──► main ──► auto-release.yml ──► tags ──► builds
   sync-run.sh      cut-fork-release.mjs    verify +          pending-release-tags   fork-release.yml
                                          Mobile Checks                             mobile-*-release.yml
```

One PR carries both the sync and the release. Merging it is what publishes.

### 1. Cut — `config/scripts/cut-fork-release.mjs`

Run on a branch, never on main. It picks the version, drafts the notes, bumps
`package.json` and `mobile/app.json`, seals the skill bundle manifest for that
version, and commits. It does **not** tag.

The version rule, pinned by `cut-fork-release.test.mjs`:

- The base is upstream's newest stable `vX.Y.Z` release, or the fork's current
  base if that is higher — it never moves backwards, because an update feed that
  goes back in time offers the same update forever.
- The rc number is one above the highest already cut for that base, read from
  tags and release subjects rather than from `package.json`, which is a working
  file and lies after a revert.
- Mobile moves only when upstream's newest `mobile-android-v*` is ahead of
  `mobile/app.json`. `versionCode` goes up by one; Android refuses to install an
  APK numbered below the one on the device, and
  `mobile/scripts/prepare-android-release.mjs` rejects a tag that disagrees with
  the committed version, so the bump has to be in the commit.

`--dry-run` reports what it would do and writes nothing. `--version X.Y.Z-rc.N`
overrides the computed version.

### 2. Merge

The release commit goes through a PR because main requires `verify` and
`Mobile Checks`. That is not a detour — it means every tag points at a commit
those checks passed.

### 3. Tag — `.github/workflows/auto-release.yml`

Runs on every push to main. `config/scripts/pending-release-tags.mjs` asks a
narrow question: *did this push change a version*. Not "is there a version
without a tag" — the fork sat at mobile `0.0.44` for months without shipping a
mobile release, and a revert or a hand-edited manifest is not a release either.
Only a version that moved gets a tag.

It then pushes `v<version>`, and `mobile-ios-v<v>` / `mobile-android-v<v>` when
mobile moved. Each tag raises its own create event, so each starts its own build.

## The one credential

The job cannot push the tags with its own `GITHUB_TOKEN`: a push made with it
deliberately creates no events, so the tag would land and nothing would build.
It pushes over SSH with a write deploy key instead — a separate credential, so
its push is a real push event.

There is no way around this. Calling `fork-release.yml` as a reusable workflow
was the obvious alternative and it does not work: its macOS leg runs in the
`apple-signing` environment, whose deployment policy admits `v*` tags and nothing
else, so a run started from main would build for forty minutes and then die at
the environment gate having published nothing.

It is also what updates the Homebrew cask. This repository *is* the tap, so
`Casks/manta@rc.rb` has to land on main after every release, carrying the version
and the two disk-image hashes — and a direct write has no pull request for the
required checks to run on, so the contents API answers 409. main's ruleset names
deploy keys as a bypass actor for exactly this: release bookkeeping that has no
PR to attach checks to. Pull requests are unaffected; they still need both checks.

Set it up once:

```sh
REPO=<owner>/<repo>
ssh-keygen -t ed25519 -N '' -C manta-release-tagger -f ./release_key
gh api "repos/$REPO/keys" -f title='release-tagger (auto-release.yml)' \
  -f key="$(cat ./release_key.pub)" -F read_only=false
gh secret set RELEASE_TAGGER_KEY --repo "$REPO" < ./release_key
rm ./release_key ./release_key.pub
```

Until the secret exists the job reports what it would have tagged and stops
green — a missing credential is a setup gap, not a broken build. Tag by hand in
the meantime:

```sh
git push origin v1.4.196-rc.0
```

Revoke by deleting the deploy key (`gh api -X DELETE repos/$REPO/keys/<id>`) and
the secret. Tags then stop being pushed and the cask stops being updated — both
say so and leave the run green — and nothing else depends on it.

main is protected by a ruleset rather than classic branch protection, because
classic protection has no bypass actors at all. The rules are the same ones it
carried: `verify` and `Mobile Checks` required, no deletion, no force-push.

## Release notes

`config/scripts/release-notes-draft.mjs` writes
`docs/release-notes/<version>.md`: a title, one sentence naming the upstream
release this picks up, and a handful of bullets grouped by conventional-commit
scope, plus any features by name. Rationale, tradeoffs and implementation stay in
the commits, which is where someone looking for them will go.

The draft is a draft — read it and trim it before the PR merges.

`cut-fork-release.mjs` refuses to commit notes carrying a personal identifier:
the maintainer's name or account, the Apple Team ID, the relay domain, an IP
address. Release notes become the public GitHub Release body and the in-app
update card. When install instructions are needed, point at the README rather
than writing an account name into the notes.
