---
name: upstream-sync
description: Pull new work from stablyai/orca into this fork. Use whenever upstream has moved and Manta should pick up their bug fixes and features — before cutting a release, or on a schedule. The fork lives on a generated, rebranded mirror of upstream, so a sync is one merge, not a cherry-pick campaign.
---

# Syncing from upstream

Manta is a fork of `stablyai/orca` that renamed the product throughout and
added three things of its own: the self-hosted relay, the mobile
internationalization, and its own release CI. A sync takes upstream's fixes
and features and leaves those three alone.

## The shape of the fork

Measured on 2026-09-02 (22,774 comparable files, every number reproduced by a
second agent): **95.6% of the fork is identical to upstream once the brand is
normalized**, 86.4% of the rest differs by the rename alone, and the evidence
rule below reproduces 5,805 of those files with zero error. The fork's real
work is about 400 shared files and 234 of its own.

So the fork is kept as **upstream + a generated transform + a small patch set**:

- `refs/sync/mirror` — upstream's history with `brand_rule.py` applied to
  every commit, paths included. Upstream speaking Manta. **Extended, never
  rebuilt**: a commit already mirrored keeps its SHA (matched by its
  `Mirror-Of:` trailer) and only what upstream added is transformed. A mirror
  rebuilt from scratch renames a few blobs differently under newer evidence,
  every commit after that point changes SHA, and a pull request between the
  two histories has no merge base — GitHub can neither diff it nor run its
  checks. That was the first sync on this model; it is why the mirror is
  incremental now.
- `refs/sync/base` — the mirror commit the fork last merged.
- `main` — the mirror, the fork's own commits, and one merge commit per sync.

A sync extends the mirror and merges it into a branch cut from `main`. With
both sides speaking Manta, **every conflict is a real one**: the same code
changed on both sides. The rename cannot conflict, a file upstream deleted
cannot come back by accident, and there is no conflict-time rebrand to get
wrong. When upstream rewrites its history (a squash — it has happened once),
no trailer matches, the mirror is rebuilt whole, and that sync is a
bootstrap-shaped event: expect the merge to be large and read it.

## Doing it

```bash
.claude/skills/upstream-sync/sync-run.sh            # from a clean tree, any branch
```

It fetches upstream, stops if `refs/sync/base` already mirrors the tip, extends
the mirror (evidence = `main`, seconds for a normal week), cuts
`sync/upstream-YYYYMMDD` from `main`, and runs

```
git merge --no-ff refs/sync/mirror
```

On a clean merge it continues into `sync-finish.sh`. On conflicts it prints
them and stops. Resolve, `git commit`, then run `sync-finish.sh` yourself. In a
merge **`--ours` is the fork and `--theirs` is upstream**.

What conflicts look like, and what to do:

| where | usually | resolution |
| --- | --- | --- |
| `mobile/**` | the fork's `translate()` wrapper against an upstream edit to the same line | `git checkout --theirs -- <file>` (take upstream), `git add`; `sync-finish.sh` re-localizes |
| modify/delete | upstream deleted a file the fork edited | if the edit was a fix upstream absorbed, `git rm` it; if it is fork feature, move it to where upstream put that code, then `git rm` the old path |
| `README.md`, `docs/readme/README.zh-CN.md` | never — `.gitattributes` keeps the fork's | — |
| lockfiles, skill manifests | never — `.gitattributes` keeps upstream's; `sync-finish.sh` regenerates | — |
| anything else | a genuine two-sided change | read both, resolve by hand |

The first real sync on this model, 2026-09-02, crossed 86 upstream commits:
10 files conflicted, 4 taken by rule (the lockfile driver, a fork-deleted
asset, two files upstream deleted that the fork had only localized or
re-commented), 6 read and resolved (two CI scripts the fork extends, a docs
section the fork owns, a styles file git correctly matched to the fork's
rename, two tests where upstream's version was simply newer). The repair
afterwards was 19 files, every one either a brand seam the rule now covers
or an upstream pin re-based to the fork's bytes. The mirror extension took
seconds.

After the merge, **read what the mirror declined** (`build-mirror.py` prints
the top of it; `sweep-brand.py refs/sync/base` lists it for the tree). A
brand-bearing name upstream introduced this sync that neither rule could
decide — a new env var, a new CamelCase family — stays upstream-spelled until
a fork commit renames it; from then on the mirror follows that decision. Most
of the list is fixture strings that should stay as upstream wrote them.

`sync-finish.sh` refolds the lockfiles, runs the mobile localizer over what
upstream added and fills `zh.json` from the translation memory
(`mobile/src/i18n/translation-memory.zh.json`, keyed by English text — a
string upstream moved keeps its translation), prints what still needs a
human translation, records the new `refs/sync/base`, commits the
regeneration, and runs `sync-verify.sh`.

## Verifying

```bash
.claude/skills/upstream-sync/sync-verify.sh refs/sync/base
```

One command, seven steps, in the only order that works, exiting non-zero on
the first thing wrong. `sync-finish.sh` runs it; run it again after every
repair. Each step is there because skipping it once let something through:

1. **Brand sweep, report only.** The mirror already speaks Manta; what this
   finds is a fork file that lost its spelling. Read the list; apply by hand.
2. **Resurrection audit** — files upstream deleted anywhere in the mirror's
   history that are still in the tree. A modify/delete resolved the wrong way.
3. **Twin audit** — `orca-X` beside `manta-X` is a rename that landed as a copy.
4. **Regenerate** the skill manifest and mobile localization, and check every
   `en.json` key has a `zh.json` entry.
5. **Root gates, all fifteen.** `pnpm lint` is fifteen commands and `oxlint`
   is the first; when it exits non-zero the other fourteen never run.
6. **Mobile gates, separately.** `mobile/` has its own oxlint, oxfmt config and
   lockfile; the root commands touch none of them. `--frozen-lockfile` is the
   point — plain `pnpm install` rewrites the lockfile and hides that it was
   upstream's.
7. **Root tests.** Re-run any failure serially before believing it: the
   `.electron` tests launch real Electron and time out at 32s under parallel
   load. `browser-route-tcp-egress` fails on any machine whose DNS answers
   `remote-browser.test`.

**What the script cannot see** — the layer where identity is a machine-readable
key rather than a word: `Symbol.for` slots, `localStorage`/`AsyncStorage` keys,
HTTP header names, on-disk file names. `tsc` does not check them and the
evidence rule needs a Manta twin that a key nobody tests never has. Three are
known and each is a migration decision, not a rename: `orca.web.onboarding.v1`
/ `orca.web.githubCache.v1` in `src/renderer/src/web/preload-api/web-storage.ts`;
`orca.mobile.connection-log.v1.` in `mobile/src/transport/persisted-connection-log-store.ts`;
`MANTAD_STATE_SNAPSHOT_DIR = 'orcad-state-snapshots'` under `.manta-remote/`.

## Landing it

Open a pull request; merge without squash. Nothing in CI runs on a push to
`main` except Mobile Checks, and a red check does not block a merge — the
2026-08-30 sync merged with 28 mobile type errors visible in CI. Read the
checks. `cross-version wire compatibility` needs an upstream release tag the
fork's remote does not carry and will stay red until that is decided.

Two things the sync itself will not tell you:

- **The version follows upstream's line.** Read their newest tag, not
  `package.json` on their main.
- **Seal the skill bundle manifest** for the release with
  `node config/scripts/generate-skill-bundle-manifest.mjs --release <version>`.

## The tools

All of them import one rule, `brand_rule.py`:

- **IDENTITY** — values that are not a word swap: `com.stablyai.orca →
  cn.sh.manta`, `onorca.dev → manta.sh.cn`. Verified against upstream's tree.
- **EVIDENCE** — a brand token is renamed only if the fork already uses its
  Manta form as a whole word. That keeps the deliberate remnants without
  enumerating most of them, because none has a Manta twin.
- **FAMILY** — second tier, for the mirror only: a file upstream adds this
  week has no Manta twin yet, but if the fork has forty `manta-runtime-*`
  files, `orca-runtime-bind-pty-incarnation-handle` is decided. A prefix that
  carries the brand plus at least one more segment (`manta-runtime`,
  `MantaRuntime`, never the bare word) counts. Never for a dotted key without
  a file extension (a storage slot — renaming one strands data), a token
  ending in `-`/`_` (a mkdtemp prefix), or a `/tmp` path. On the replayed
  sync it covered 42% of what the direct rule declined, at 100% precision on
  a sample.
- **SEGMENT** — a relative import (`../main/orcad/x`) never matches a
  repository-relative family, but `mantad` being a directory here decides it.
  Any path segment whose Manta form is a file or directory name the fork has
  counts. Missed once: three typecheck errors and twenty test files that
  could not load.
- **DOTTED** — a token with two or more dots and no slash is a key, judged
  segment by segment: `remote.<name>.orca-created` renames its last segment
  because `manta-created` is what the desktop reads, while `orca.host.x`
  stays because a bare brand segment proves nothing. One dot and a short
  extension is a filename (`orca-installer-hooks.nsh`), never a key.
- **KEEP** — the few that do and must still stay: `stablyai/orca` (guards the
  workflows this fork must never run), the skill aliases, `/usr/bin/orca` and
  the phrase `GNOME Orca` (Ubuntu's screen reader — the reason the Linux binary
  is `manta-ide`), the App Store URL. **KEEP_PATH** — files that are *about*
  upstream, or where Orca is the whale.

Before this module there were two copies with different rules, and the
conflict-time one renamed blindly with an identity map pointing at a bundle id
upstream never used. That is where "GNOME Manta screen reader" and
`com.stablyai.manta` came from.

**`build-mirror.py`** streams upstream's new commits through `git fast-import`
on top of the mirror it finds, referencing unchanged blobs by SHA and emitting
only transformed ones. Blobs the mirror already carries keep their names — an
unchanged file is referenced, not re-decided under newer evidence. Evidence
is read once with a single ripgrep pass over a checkout of the fork — `git grep
-f` with the same patterns is superlinear, 500 took 83 seconds — with patterns
longest-first, because ripgrep's alternation is leftmost-first and a short
pattern shadows every longer one it prefixes. 387 commits in eight minutes.
`--report` prints how much of the fork the mirror reproduces; expect ≥95%.

**`sync-bootstrap.sh`** is the one-time move onto the mirror: the fork's tree
over the mirror's, dropping only what the fork's history deleted on purpose
and code files nothing imports (upstream's parallel splits of components the
fork had already replaced — found by resolving imports, since a basename
match cannot tell `../src/pair-scan-styles` from `../src/theme/pair-scan-styles`).
It edits no content; a bootstrap that also cleans up cannot be checked against
the fork it came from.

**`sync-selftest.sh`** replays a sync the fork already absorbed by hand and
diffs the outcome against it; run it after changing any tool. Replaying this
week's — 371 upstream commits — as a merge: 40 files conflicted, 16 resolved
by rule, 24 for a person, of which two more go to rules once `.gitattributes`
is in the base and the rest are relay hooks and skill prose upstream also
edited. The cherry-pick path had produced 372 blind-rebranded picks, a 92-file
repair commit and 24 failing tests for the same range.
**`sweep-brand.py`** and **`rebrand-merge.py`** remain for reading and for
the old cherry-pick path; neither is part of the sync now.

## What this fork owns

Upstream must never overwrite these. If a conflict touches one, stop and think:

- `relay-server/` and everything about the self-hosted relay
- `mobile/src/i18n/` and the `translate()` wrappers throughout `mobile/`
- `.github/workflows/fork-release.yml` and the fork's contract tests
- the three dev-channel mac workflows, whose job guards point at
  `stablyai/orca` on purpose so this fork never runs them
- `README.md`, `docs/readme/README.zh-CN.md`

## Moving `main` onto the mirror (once)

`sync/mirror-bootstrap` is `main`'s content on the mirror's history. To make
it `main`:

```bash
.claude/skills/upstream-sync/sync-cutover.sh     # asks before it does anything
```

It keeps the old `main` as `main-legacy`, lifts the force-push block for one
push and restores it, and publishes the sync refs. `main` is protected:
`verify` and `Mobile Checks` must pass before a merge.

Every open branch based on the old `main` must be rebased onto the new one
(`git rebase --onto main main-legacy <branch>`) — the trees match, so that is
mechanical. Publish the sync refs so a fresh clone can pick up where this one
left off: `git push origin refs/sync/base refs/sync/mirror`. `sync-run.sh`
fetches them from origin before it starts, and `sync-finish.sh` says when to
push them again.

## How it got here

Until 2026-09-02 a sync matched upstream commits by subject and cherry-picked
the difference, with a blind rebrand at conflict time and a manual sweep after.
Every sync ended with a repair commit of a few hundred files — 344, 324, 380,
92 — because the rename was stored as 6,100 files of history and replayed
against every pick. Half-renames, resurrected deletions, un-localized upstream
features and a release workflow left on the wrong pnpm were all one week's
fallout. The census above is what made the mirror the obvious shape.
