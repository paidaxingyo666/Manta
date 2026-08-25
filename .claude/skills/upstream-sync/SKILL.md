---
name: upstream-sync
description: Pull new work from stablyai/orca into this fork. Use whenever upstream has moved and Manta should pick up their bug fixes and features — before cutting a release, or on a schedule. Handles the rebrand collision that makes a plain `git merge` unusable here.
---

# Syncing from upstream

Manta is a fork of `stablyai/orca` that renamed the product throughout and
added three things of its own: the self-hosted relay, the mobile
internationalization, and its own release CI. The job of a sync is to take
upstream's fixes and features while leaving those three alone.

## The thing that makes this hard

**Upstream rewrites `main`.** The commit this fork merged on 19 August as
`62469e4415` is `73f7767edd` upstream today — same pull request, different
SHA. So `git merge-base` walks back to the last point where SHAs still line
up, which is weeks old, and `git merge upstream/main` offers hundreds of
commits this fork already has.

Merging them replays every one against the rebrand. Measured on 23 August:
275 offered, 194 already present, **564 conflicted files and 1715 hunks**,
almost all of them ghosts. It also recurs — every sync fights the same
conflicts again, and `fix: repair rename fallout the merge surfaced` in this
fork's history is the residue of one such attempt.

So: **never `git merge upstream/main`.** Match by subject, cherry-pick the
difference.

## Doing it

```bash
git fetch upstream --tags
git checkout -b sync/upstream-$(date +%Y%m%d)
```

Find what is genuinely new. Subject is the only stable identity across a
rewritten history — patch-ids do not survive the rebrand either:

```python
python3 - <<'PY'
import subprocess, pathlib
ours = set(subprocess.run(['git','log','--format=%s','HEAD'],
                          capture_output=True, text=True).stdout.splitlines())
up = subprocess.run(['git','log','--format=%H\t%s','--reverse','upstream/main'],
                    capture_output=True, text=True).stdout.splitlines()
new = [l.split('\t')[0] for l in up if l.split('\t', 1)[1] not in ours]
pathlib.Path('/tmp/picks.txt').write_text('\n'.join(new))
print('genuinely new:', len(new))
PY
```

> Do not use "the newest upstream commit whose subject we already have" as a
> cut point. A rewritten history interleaves, so commits *before* that point
> can still be missing — the 23 August sync would have skipped the whole
> `src/main/wsl/` module that way, and the commit that needs it landed anyway.

Then drive the picks. `sync-run.sh` stops the moment something needs a person:

```bash
bash .claude/skills/upstream-sync/sync-run.sh /tmp/picks.txt /tmp/status.txt
```

It disables hooks for the duration — lint-staged reformats what it is given,
and a sync must land upstream's bytes. The gates at the end settle formatting.

When it stops: resolve the file, `git add` it, then either
`git -c core.editor=true cherry-pick --continue` or, if the pick emptied out,
`git cherry-pick --skip`. Recompute the remaining list (the subject snippet
above) and run the driver again — it is idempotent.

## What the tools do

**`rebrand-merge.py`** — the reason most conflicts are not real ones. Upstream's
file says Orca, ours says Manta, so git sees two different lines where there is
one change. Rewriting the base and the incoming side into Manta *first* turns
the conflict back into the ordinary three-way merge it actually is. It also
knows four shapes that have no stages to merge:

| git status | meaning | what it does |
| --- | --- | --- |
| `UU` | both changed | three-way merge with both non-ours sides rebranded |
| `UD` | upstream deleted, we changed | accept the deletion **only** if our copy differs from theirs by brand alone |
| `DU` + renamed twin exists | the rebrand renamed the file | merge upstream's change onto the twin, drop the old path |
| `DU` + our history has the delete | the fork dropped it on purpose | stay deleted |

That last distinction matters: "we deliberately deleted it" (the README
translations this fork does not maintain) and "we never received the commit
that added it" look identical in the index. Our own history carrying the
delete is what separates them, and only the first may be resolved by deleting.

`pnpm-lock.yaml` takes upstream's outright — a merged lockfile resolves to
nothing real. Run `pnpm install --lockfile-only` afterwards to fold this fork's
package.json back in, then `pnpm install`.

`README.md` and `docs/readme/README.zh-CN.md` keep ours. They are rewrites, and
upstream's edits to them are about upstream's App Store listing and cloud. Every
skip is printed, so an upstream change worth porting is visible rather than
silent.

**`sweep-brand.py`** — for what the *clean* picks bring in, which is the part
that bites. A commit that applies without conflict lands upstream's spelling
verbatim, and the build dies on a path this fork renamed long ago:

```
error: Could not resolve ".../src/main/runtime/orca-runtime.ts"
```

```bash
python3 .claude/skills/upstream-sync/sweep-brand.py <rev-before-the-sync>          # dry run
python3 .claude/skills/upstream-sync/sweep-brand.py <rev-before-the-sync> --apply
```

The rule is evidence: a token is renamed only when its Manta counterpart
already exists in the tree **as a whole word**. That preserves the deliberate
remnants without enumerating them, because none of them has a Manta twin. A
short KEEP list covers the handful that do and must still stay:

- `stablyai/orca` — guards the workflows this fork must never run
- `orca-cli`, `orca-emulator`, `orca-emulator-android`, `orca-linear`,
  `orca-per-workspace-env` — backwards-compatible skill aliases; renaming them
  makes already-installed skills unresolvable
- `GNOME Orca`, `/usr/bin/orca` — Ubuntu's screen reader, and the reason the
  Linux binary is `manta-ide` and not `manta`

Everything it declines is printed. That list is where the next decision lives —
it is how `orcad`, upstream's new plain-Node runtime daemon, surfaced as a
naming question rather than as a silent import of upstream's brand.

## Where the rename hides

Three syncs have now found fallout in the test suite rather than the build.
These are the shapes that a search misses:

**Article agreement.** Upstream writes "an Orca"; a substitution leaves "an
Manta". Both tools fix this, but only on lines they already touch.

**Offsets into strings that contain the brand.** `stablyai/orca` puts "orca" at
9–13; `paidaxingyo666/Manta` does not. Palette-search tests assert character
ranges, and the numbers go stale while the implementation stays right.

**Adjacent brand names.** `'__ORCA_AGENT_PATH__orca-fake-cli'` is one token to a
tokenizer but two names to a person — a sentinel this fork renamed glued to a
fixture it did not. `sweep-brand.py` now splits on `__` and judges the halves
separately.

**Prefixes asserted through a regexp.** `/^manta\.linear\.v1\./` contains
escapes, so a fixed-string search for `manta.linear.v1.` does not find it. The
implementation kept emitting `orca.linear.v1.` while its own test demanded
otherwise. There is no general fix; run the tests.

## Finishing

```bash
pnpm install                 # the sync may have brought new dependencies
pnpm lint
pnpm typecheck
pnpm test
```

Run the full suite, with the project's vitest config — a bare `vitest` misses
the gates. Expect timeouts under load: a saturated machine fails
`check-root-directory-entries` at 128 seconds for a test that is normally
instant. Re-run anything that failed with `--maxWorkers=3` before believing it,
and check a suspect against the pre-sync branch before treating it as new.

Two things the sync itself will not tell you:

- **The version follows upstream's line.** Read their newest tag, not
  `package.json` on their main — their release-cut writes the version in a
  separate commit, so main always lags. After 79 commits on 23 August,
  upstream's newest was `v1.4.188`, so this fork went to `1.4.189-rc.0`.

  Ask the remote, not the local tag list. `git fetch upstream --tags` pulls
  2000+ of their tags in beside this fork's own, and `git tag -l` then reports
  whichever sorts highest — on 25 August that was `v1.4.189-rc.6`, which is
  *ours*. Upstream was still on `v1.4.188`.

  ```bash
  git ls-remote --tags upstream | grep -v '\^{}' |
    grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$' | sort -V | tail -1
  ```
- **Skill revisions need sealing at the new version.** Compare
  `resources/skills/current-manifest.json` against the last row of
  `release-mapping.json`; if they disagree, run
  `node config/scripts/generate-skill-bundle-manifest.mjs --release <version>`.
  Left unsealed, the next regeneration reassigns a revision number to different
  bytes and every installed copy stops matching a known snapshot.

## Landing it

**Open a pull request. Do not push the sync straight to `main`.**

Nothing in this repo's CI runs on a push to `main` — `pr.yml` and `mobile.yml`
both trigger on `pull_request` only, and the release workflow builds without
testing. A sync pushed directly is a few hundred files that no CI has ever
seen; the 25 August one landed that way and its only evidence was a local
test run.

`mobile.yml` matters most here, because it is the only job that loads the
Fastfile — the iOS signing config and the NSE target's provisioning. A local
`vitest` pass over `mobile/` does not cover any of that, and this sync changed
67 files under `mobile/`.

```bash
git push -u origin sync/upstream-<date>
gh pr create --repo <fork> --base main --fill
gh pr checks --repo <fork> --watch
```

Merge once the checks are green, then cut the tag per
`docs/reference/release-secrets.md`.

Push the tag only after `main` is where you want it. Pushing the tag first and
rebasing afterwards leaves the tag on an orphaned commit, and moving it means
force-updating a ref that a published release already points at.

## What this fork owns

Upstream must never overwrite these. If a pick touches one, stop and think:

- `relay-server/` and everything about the self-hosted relay
- `mobile/src/i18n/` and the `translate()` wrappers throughout `mobile/`
- `.github/workflows/fork-release.yml` and the fork's contract tests
- the three dev-channel mac workflows, whose job guards point at
  `stablyai/orca` on purpose so this fork never runs them
- `README.md`, `docs/readme/README.zh-CN.md`
