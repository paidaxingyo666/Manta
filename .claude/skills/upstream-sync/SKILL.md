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

All three brand tools import one rule, `brand_rule.py`. Before 2026-09-02 there
were two copies with different rules: `rebrand-merge.py` renamed blindly at
conflict time, with no KEEP list and an identity map that pointed at a bundle
id upstream never used — and that is precisely where "GNOME Manta screen
reader" and the bundle id `com.stablyai.manta` came from. Change the rule in
one place, and every tool changes with it.

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
.claude/skills/upstream-sync/sync-verify.sh main
```

One command, seven steps, in the only order that works, and it exits non-zero
on the first thing wrong. Do not run its pieces by hand; every step exists
because skipping it once let something through:

1. **sweep-brand, first.** A clean pick lands upstream's spelling verbatim.
   Skipped on 2026-09-01: 32 files, including e2e helpers importing
   `./orca-app`, which broke `pnpm test` collection — the unit suite, not just
   Playwright.
2. **Resurrection audit.** Files a picked upstream commit deleted but which are
   still in the tree. A modify/delete conflict "resolved" by keeping the file
   brought back `src/main/linear/issues.ts` — 1400 lines upstream had split into
   seven modules this fork already carried, plus the `eslint-disable max-lines`
   the ratchet then failed on. Matched by subject, not the `-x` trailer, because
   two thirds of the picks lose the trailer to conflict resolution.
3. **Twin audit.** `orca-X` beside `manta-X` is a rename that landed as a copy.
4. **Regenerate generated artifacts** — skill manifest, the mobile localizer,
   and a check that every `en.json` key has a `zh.json` entry. The sync brought
   a whole network-diagnostics surface in English: 3 unlocalized call sites and
   23 keys behind them.
5. **Root gates, all fifteen.** `pnpm lint` is fifteen commands and `oxlint` is
   the first; when it exits non-zero the other fourteen never run.
   `check:max-lines-ratchet` and `verify:localization-coverage:mobile` catch
   what nothing else does.
6. **Mobile gates, separately.** `mobile/` has its own oxlint, oxfmt config and
   lockfile; the root commands touch none of them. `--frozen-lockfile` is the
   point — plain `pnpm install` rewrites the lockfile and hides that it was
   upstream's, which is exactly what mobile CI then failed on.
7. **Root tests.** Re-run any failure serially before believing it: the
   `.electron` tests launch real Electron and time out at 32s under parallel
   load.

Then read what the sweep **declined**. That list is not noise — a token with no
Manta twin is either fine (GNOME Orca, `stablyai/orca`) or a file this fork
should have renamed and has not.

**What the script cannot see** — the layer where identity is a machine-readable
key rather than a word: `Symbol.for` slots, `localStorage`/`AsyncStorage` keys,
HTTP header names, on-disk file names. `tsc` does not check them and the
evidence rule needs a Manta twin that a key nobody tests never has. Three are
known and each is a migration decision, not a rename: `orca.web.onboarding.v1`
/ `orca.web.githubCache.v1` beside four `manta.web.*` keys in
`src/renderer/src/web/preload-api/web-storage.ts`; `orca.mobile.connection-log.v1.`
in `mobile/src/transport/persisted-connection-log-store.ts`; and
`MANTAD_STATE_SNAPSHOT_DIR = 'orcad-state-snapshots'` under `.manta-remote/` on
every remote host. Renaming any of them strands existing users' data.

Two things the sync itself will not tell you:

- **The version follows upstream's line.** Read their newest tag, not
  `package.json` on their main — their release-cut writes the version in a
  separate commit, so main always lags.
- **Seal the skill bundle manifest** for the release with
  `node config/scripts/generate-skill-bundle-manifest.mjs --release <version>`.
  Left unsealed, the next regeneration reassigns a revision number to different
  bytes and every installed copy stops matching a known snapshot.

## Landing it

**Open a pull request. Do not push the sync straight to `main`.**

Almost nothing in this repo's CI runs on a push to `main`. `pr.yml` triggers on
`pull_request` only and the release workflow builds without testing; `mobile.yml`
gained a push trigger on 2026-09-01, so a merge that breaks mobile now says so
within the hour — but that is a smoke alarm, not a gate, and it covers `mobile/`
alone. A sync pushed straight to `main` is still a few hundred files whose
desktop side no CI has ever seen; the 25 August one landed that way and its only
evidence was a local test run.

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

## Why every sync has needed a repair commit

Every sync so far has ended with a commit of a few hundred files repairing
what the picks broke: 344 files, 324, 380, 92. That is not bad luck. It is the
cost of the shape this fork is in, and on 2026-09-02 it was measured
(`upstream/main` 5aa02ead59 against fork e8fdc1c84b, every number reproduced by
a second, independent agent):

- **22,774 comparable files. 95.6% are identical once the brand is
  normalized.** Of the 7,355 files that are not byte-identical, 86.4% differ
  *only* by the rename. Real customization is under 14%.
- **5,805 files are reproduced with zero error by the evidence rule alone.**
  The rename is a deterministic function of upstream's tree, not a fact of
  history — and today it is stored as history: 6,100 files of diff, replayed
  against every pick.
- **The fork's real work is small and concentrated**: 401 shared files carry
  the three owned features (mobile i18n 278, relay endpoints 94, release CI 29),
  plus 234 fork-only files. Relay's touch on shared code is ~94 files of
  few-line hooks; release CI is almost entirely under `.github/` and
  `config/scripts/`.
- **Mobile i18n is itself a generator's output.** Replaying `sweep-brand →
  localize-renderer-strings.mjs --target mobile → oxfmt` on upstream's tree
  reproduces about two thirds of the fork's 1,541 `translate()` call sites
  mechanically. The rest is one design choice: keys are `sha1(path:text)`, so
  every time upstream moves code the key changes and `zh.json` orphans the
  translation — 661 keys orphaned in that experiment. Keyed by text alone,
  99.4% survive.
- **Identity lives as 9,941 bare literals against 163 named constants**, and
  upstream writes it the same way, so centralizing on the fork side would turn
  every upstream hunk into a conflict. The tool has to be right instead.
- **Subject matching is lossy.** Of 377 same-subject twins, 58 (15.4%) carry
  different content — #17517 landed here with 1,300 lines upstream's squash
  does not have. Upstream's main is a fresh squash history since 2026-08-28
  and will be rewritten again. The PR number in the subject (`#NNNNN`) is a
  stabler identity than the subject; a same-subject pick whose diff differs
  from upstream's should be a warning, not silence.
- **The max-lines ratchet is self-inflicted drift.** Forbidding upstream's own
  `eslint-disable max-lines` made this fork split 21 files (1,873 lines) that
  upstream later split differently. Grandfather upstream's suppressions in the
  baseline; forbid only new fork-authored ones.

### The way out

Given those numbers, the fork should stop *being* a rebranded copy and become
**upstream + a generated transform + a small patch set**:

1. **Generate the rebrand instead of storing it.** Keep a mirror branch,
   `upstream-manta`, that is `upstream/main` with `brand_rule.py` applied to
   every commit (paths included). Regenerate it from scratch on each fetch — it
   is deterministic, upstream's whole history is 387 commits, and the census
   is the acceptance test: the mirror must match the fork on ≥95% of files.
2. **Rebase the patch set onto the mirror.** With both sides speaking Manta,
   `git rebase` of the fork's own commits onto the fresh mirror conflicts only
   where upstream edited a file the fork also edited — a few hundred files, not
   six thousand. Half-renames cannot happen because there is no brand conflict
   to resolve; resurrections cannot happen because deletions are real merges.
3. **Regenerate mobile i18n rather than rebasing it.** Run the localizer on
   the fresh tree, fill `zh.json` from a translation memory keyed by English
   text, and keep the residual (module-scope constants, strings the localizer
   cannot see, exemptions) as a rule file that replays — not as hand edits
   inside upstream's files.
4. **Keep `sync-verify.sh` as the single gate**, and put branch protection on
   `main` with `verify` and `Mobile Checks` required. The 2026-08-30 sync
   merged with 28 mobile type errors visible in CI; nothing enforced them.

Until the mirror exists, the current flow stands, with the unified rule and
`sync-verify.sh` closing the gaps the last sync exposed. Steps 1–3 are a
change to how the fork is kept, not to what it ships, and they are the user's
call.
