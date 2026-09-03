#!/usr/bin/env node
/**
 * Cut this fork's next release: pick the version, write the notes, seal the
 * skill manifest, commit and tag.
 *
 * Pushing the tag is what publishes — `fork-release.yml` triggers on `v*` and
 * builds macOS, Windows and Linux, and installed copies auto-update to what it
 * publishes. So this stops at the tag by default and prints the push command;
 * `--push` does it.
 *
 * The version follows upstream's line, which is why a sync is the natural time
 * to run this: upstream ships 1.4.196, this fork ships 1.4.196-rc.N once it has
 * merged that work. The base never moves backwards, and an rc number is never
 * reused — `release-rc-history.mjs` reads what has already been cut from tags
 * and release subjects rather than trusting package.json, which is a working
 * file and lies after a revert.
 *
 * Usage:
 *   cut-fork-release.mjs [--version X.Y.Z-rc.N] [--push] [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fetchReleases, latestStableDesktopReleaseTag } from './latest-stable-release.mjs'
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
  const tag = latestStableDesktopReleaseTag(await fetchReleases(UPSTREAM_REPO, token))
  if (!tag) {
    fail(`${UPSTREAM_REPO} has no stable vX.Y.Z release`)
  }
  return tag.replace(/^v/, '')
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
 * Notes for a version that has none yet: the merged subjects since the last
 * release, for someone to distil. Left long on purpose — trimming is a judgment
 * call, and a scaffold that reads like a changelog is easier to cut down than a
 * blank file is to fill.
 */
function draftReleaseNotes(version, previousTag) {
  const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'
  const subjects = git('log', '--format=%s', '--no-merges', range)
    .split('\n')
    .filter(Boolean)
    .filter((subject) => !/^(chore|docs|style|test|ci)\(sync\)|^sync:/i.test(subject))
    .slice(0, 40)
  return [
    `# ${version}`,
    '',
    'Picks up upstream fixes and features.',
    '',
    ...subjects.map((subject) => `- ${subject}`),
    ''
  ].join('\n')
}

function assertNoPrivateIdentifiers(file) {
  const text = readFileSync(file, 'utf8')
  const hits = PRIVATE_PATTERNS.filter((pattern) => pattern.test(text)).map(String)
  if (hits.length > 0) {
    fail(`release notes carry personal identifiers (${hits.join(', ')}): ${file}`)
  }
}

async function main() {
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') {
    fail('cut releases from main')
  }
  if (git('status', '--porcelain', '--untracked-files=no')) {
    fail('working tree is not clean')
  }
  git('fetch', '--quiet', 'origin', 'main')
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    fail('main is not in sync with origin/main')
  }

  const packagePath = path.join(root, 'package.json')
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  const currentBase = manifest.version.split('-')[0]

  let version = value('--version')
  if (!version) {
    const upstreamBase = await upstreamStableBase()
    // Never backwards: a fork-only fix cut ahead of upstream keeps its base.
    const base = compareBases(upstreamBase, currentBase) > 0 ? upstreamBase : currentBase
    const highest = highestRcForBase(base, { cwd: root })
    version = `${base}-rc.${highest === null ? 0 : highest + 1}`
    console.log(`  upstream stable ${upstreamBase} · fork at ${manifest.version} → ${version}`)
  }
  const tag = `v${version}`
  if (git('tag', '--list', tag)) {
    fail(`${tag} already exists locally`)
  }
  if (
    execFileSync('git', ['ls-remote', '--tags', 'origin', tag], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
  ) {
    fail(`${tag} already exists on origin`)
  }

  // Not `--merged HEAD`: the 2026-09-02 cutover put main on a generated mirror
  // of upstream, so every tag cut before it is reachable only from main-legacy.
  // Newest by version is what "since the last release" means here regardless.
  const previousTag =
    git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').find(Boolean) ?? null
  const notesPath = path.join(root, 'docs', 'release-notes', `${version}.md`)
  const notesExist = existsSync(notesPath)

  if (dryRun) {
    console.log(`\n  would cut ${tag}`)
    console.log(`  since: ${previousTag ?? '(no previous tag)'}`)
    console.log(
      `  notes: ${path.relative(root, notesPath)}${
        notesExist
          ? ' (already written)'
          : ` (would draft from ${
              draftReleaseNotes(version, previousTag)
                .split('\n')
                .filter((line) => line.startsWith('- ')).length
            } commit subjects)`
      }`
    )
    process.exit(0)
  }

  const wroteDraft = !notesExist
  if (wroteDraft) {
    mkdirSync(path.dirname(notesPath), { recursive: true })
    writeFileSync(notesPath, draftReleaseNotes(version, previousTag))
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

  git('add', 'package.json', 'resources/skills', path.relative(root, notesPath))
  execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', `chore(release): cut ${version}`],
    {
      cwd: root
    }
  )
  git('tag', tag)
  console.log(`\n  ${tag} committed and tagged at ${git('rev-parse', '--short', 'HEAD')}`)
  if (wroteDraft) {
    console.log(
      `  notes were drafted from commit subjects — read ${path.relative(root, notesPath)} and trim it`
    )
    console.log('  (amend the commit and re-tag with `git tag -f` if you edit them)')
  }

  if (flag('--push')) {
    git('push', 'origin', 'main')
    git('push', 'origin', tag)
    console.log(`  pushed — fork-release.yml is building ${tag}`)
  } else {
    console.log(`\n  publish with:  git push origin main && git push origin ${tag}`)
  }
}

main().catch((error) => fail(error.message))
