#!/usr/bin/env node
/**
 * Cut this fork's next release: pick the version, write the notes, bump the
 * desktop and mobile manifests, seal the skill bundle, commit.
 *
 * It stops at the commit. Tagging is `auto-release.yml`'s job, which runs on
 * every push to main and pushes whatever tag package.json and mobile/app.json
 * say is missing. So a release travels the same road as every other change — a
 * branch, a PR, the required checks — and merging it is what publishes.
 *
 * Why not tag here and push to main directly: main requires `verify` and
 * `Mobile Checks`, so a freshly made commit cannot be pushed to it at all. And a
 * release that skipped the checks would be the one release nothing verified.
 *
 * The version follows upstream's line, which is why a sync is the natural time
 * to run this: upstream ships 1.4.196, this fork ships 1.4.196-rc.N once it has
 * merged that work. The base never moves backwards, and an rc number is never
 * reused — `release-rc-history.mjs` reads what has already been cut from tags
 * and release subjects rather than trusting package.json, which is a working
 * file and lies after a revert.
 *
 * Usage:
 *   cut-fork-release.mjs [--version X.Y.Z-rc.N] [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { fetchReleases, latestStableDesktopReleaseTag } from './latest-stable-release.mjs'
import { draftReleaseNotes } from './release-notes-draft.mjs'
import { highestRcForBase } from './release-rc-history.mjs'

const UPSTREAM_REPO = 'stablyai/orca'
// Anything that identifies the maintainer personally. Release notes become the
// GitHub Release body and the in-app update card, so they are public.
const PRIVATE_PATTERNS = [
  /paidaxingyo666/i,
  /Li ChangQing/i,
  /G5J7URYYG5/,
  /manta\.sh\.cn/i,
  /\b\d{1,3}(\.\d{1,3}){3}\b/,
  /bruceli/i
]

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const dryRun = flag('--dry-run')

function git(...rest) {
  return execFileSync('git', rest, { cwd: root, encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const MOBILE_TAG = /^mobile-android-v([0-9]+\.[0-9]+\.[0-9]+)$/

/**
 * Upstream's newest mobile release. The phone app has its own version line
 * (0.0.x) and its own release cadence, but the same rule applies: this fork
 * ships what upstream shipped, once it has merged it. Android's tag is the
 * marketing version both platforms read out of mobile/app.json; iOS publishes
 * to TestFlight and has no GitHub release to read.
 */
export function upstreamMobileVersion(releases) {
  const versions = releases
    .map((release) => MOBILE_TAG.exec(release.tag_name ?? '')?.[1])
    .filter(Boolean)
    .sort((a, b) => {
      const l = a.split('.').map(Number)
      const r = b.split('.').map(Number)
      for (let i = 0; i < 3; i += 1) {
        if ((l[i] ?? 0) !== (r[i] ?? 0)) {
          return (l[i] ?? 0) - (r[i] ?? 0)
        }
      }
      return 0
    })
  return versions.at(-1) ?? null
}

/** Upstream's newest shipped release, which is the line this fork's version follows. */
async function upstreamStableBase() {
  let token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (!token) {
    try {
      token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
    } catch {
      fail('no GitHub token: set GITHUB_TOKEN or run `gh auth login`')
    }
  }
  const releases = await fetchReleases(UPSTREAM_REPO, token)
  const tag = latestStableDesktopReleaseTag(releases)
  if (!tag) {
    fail(`${UPSTREAM_REPO} has no stable vX.Y.Z release`)
  }
  return { desktop: tag.replace(/^v/, ''), mobile: upstreamMobileVersion(releases) }
}

function compareBases(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) {
      return (left[i] ?? 0) - (right[i] ?? 0)
    }
  }
  return 0
}

/**
 * Move the phone app onto upstream's mobile version, if upstream has shipped one
 * this fork has not. Both platforms read the marketing version out of
 * mobile/app.json — `prepare-android-release.mjs` refuses a tag that disagrees
 * with the committed one, and iOS falls back to it — so the bump has to be a
 * commit, not a release-time argument. versionCode only ever goes up: Android
 * refuses to install an APK numbered below the one on the device.
 *
 * Returns the version cut, or null when upstream is not ahead.
 */
function bumpMobileVersion(upstreamMobile, { write }) {
  if (!upstreamMobile) {
    return null
  }
  const configPath = path.join(root, 'mobile', 'app.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const current = String(config.expo.version)
  if (compareBases(upstreamMobile, current) <= 0) {
    return null
  }
  if (write) {
    config.expo.version = upstreamMobile
    config.expo.android.versionCode = Number(config.expo.android.versionCode) + 1
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  }
  return { version: upstreamMobile, from: current }
}

/**
 * Commits since the previous release, each flagged with whether it came from
 * upstream. The `Mirror-Of:` trailer is the mirror's own record of which
 * upstream commit a replayed commit is; a commit without one is the fork's.
 */
function commitsSincePreviousTag(previousTag) {
  // git's own escape, not a literal separator in argv: Node refuses to pass a
  // NUL byte to execFile, and a printable separator can appear in a subject.
  return git(
    'log',
    '--format=%s%x1f%(trailers:key=Mirror-Of,valueonly=true)',
    '--no-merges',
    previousTag ? `${previousTag}..HEAD` : 'HEAD'
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [subject, mirrorOf = ''] = line.split('\u001f')
      return { subject, upstream: mirrorOf.trim() !== '' }
    })
}

function assertNoPrivateIdentifiers(file) {
  const text = readFileSync(file, 'utf8')
  const hits = PRIVATE_PATTERNS.filter((pattern) => pattern.test(text)).map(String)
  if (hits.length > 0) {
    fail(`release notes carry personal identifiers (${hits.join(', ')}): ${file}`)
  }
}

async function main() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch === 'main') {
    fail('cut on a branch, not main — the release commit goes through a PR like anything else')
  }
  if (git('status', '--porcelain', '--untracked-files=no')) {
    fail('working tree is not clean')
  }
  git('fetch', '--quiet', 'origin', 'main')
  // Cutting from a branch that is behind main would compute the version from a
  // stale upstream base and write notes missing whatever landed in between.
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { cwd: root })
  } catch {
    fail(`${branch} is behind origin/main — rebase before cutting`)
  }

  const packagePath = path.join(root, 'package.json')
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  const currentBase = manifest.version.split('-')[0]

  const upstream = await upstreamStableBase()
  // Never backwards: a fork-only fix cut ahead of upstream keeps its base.
  const base = compareBases(upstream.desktop, currentBase) > 0 ? upstream.desktop : currentBase
  let version = value('--version')
  if (!version) {
    const highest = highestRcForBase(base, { cwd: root })
    version = `${base}-rc.${highest === null ? 0 : highest + 1}`
    console.log(`  upstream stable ${upstream.desktop} · fork at ${manifest.version} → ${version}`)
  }
  // origin, not the local tag list: this clone fetches upstream, so upstream's
  // own tags live here — all 22 of its mobile-android-v* among them. The fork
  // follows upstream's mobile version, so every mobile tag it is about to cut
  // collides locally with the upstream tag of the same name and no fork tag at
  // all. What matters is whether the tag has been published to this fork.
  const assertTagIsFree = (name) => {
    if (
      execFileSync('git', ['ls-remote', '--tags', 'origin', name], {
        cwd: root,
        encoding: 'utf8'
      }).trim()
    ) {
      fail(`${name} already exists on origin`)
    }
  }
  const tag = `v${version}`
  assertTagIsFree(tag)

  // Not `--merged HEAD`: the 2026-09-02 cutover put main on a generated mirror
  // of upstream, so every tag cut before it is reachable only from main-legacy.
  // Newest by version is what "since the last release" means here regardless.
  const previousTag =
    git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').find(Boolean) ?? null
  const notesPath = path.join(root, 'docs', 'release-notes', `${version}.md`)
  const notesExist = existsSync(notesPath)

  const mobile = bumpMobileVersion(upstream.mobile, { write: false })
  if (mobile) {
    assertTagIsFree(`mobile-ios-v${mobile.version}`)
    assertTagIsFree(`mobile-android-v${mobile.version}`)
  }

  if (dryRun) {
    console.log(`\n  would cut ${tag}`)
    console.log(`  since: ${previousTag ?? '(no previous tag)'}`)
    console.log(
      `  mobile: ${
        mobile
          ? `${mobile.from} → ${mobile.version} (mobile-ios-v${mobile.version}, mobile-android-v${mobile.version})`
          : `unchanged, upstream is not ahead of ${JSON.parse(readFileSync(path.join(root, 'mobile', 'app.json'), 'utf8')).expo.version}`
      }`
    )
    console.log(
      `  notes: ${path.relative(root, notesPath)}${
        notesExist
          ? ' (already written)'
          : ` (${
              draftReleaseNotes(commitsSincePreviousTag(previousTag), version, base)
                .split('\n')
                .filter((line) => line.startsWith('- ')).length
            } bullets)`
      }`
    )
    process.exit(0)
  }

  const wroteDraft = !notesExist
  if (wroteDraft) {
    mkdirSync(path.dirname(notesPath), { recursive: true })
    writeFileSync(notesPath, draftReleaseNotes(commitsSincePreviousTag(previousTag), version, base))
  }
  assertNoPrivateIdentifiers(notesPath)

  manifest.version = version
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  // Seal the manifest for this version: left unsealed, the next regeneration
  // reassigns a revision number to different bytes and every installed copy
  // stops matching a known snapshot.
  execFileSync(
    'node',
    ['config/scripts/generate-skill-bundle-manifest.mjs', '--release', version],
    {
      cwd: root,
      stdio: 'inherit'
    }
  )

  const toStage = ['package.json', 'resources/skills', path.relative(root, notesPath)]
  if (mobile) {
    bumpMobileVersion(upstream.mobile, { write: true })
    toStage.push('mobile/app.json')
  }
  git('add', ...toStage)
  const subject = mobile
    ? `chore(release): cut ${version} and mobile ${mobile.version}`
    : `chore(release): cut ${version}`
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', subject], {
    cwd: root
  })
  console.log(`\n  ${git('rev-parse', '--short', 'HEAD')}  ${subject}`)
  console.log(
    `  notes: ${path.relative(root, notesPath)}${wroteDraft ? ' (drafted — read it)' : ''}`
  )
  const willTag = mobile
    ? `${tag}, mobile-ios-v${mobile.version}, mobile-android-v${mobile.version}`
    : tag
  console.log(`\n  open a PR from ${branch}; merging it tags ${willTag} and builds`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error.message))
}
