#!/usr/bin/env node
/**
 * Which release tags the commit on main is missing.
 *
 * `auto-release.yml` runs this on every push to main and pushes what it names.
 * The question it answers is narrow on purpose: not "is there a version without
 * a tag" but "did this push change a version". A repository can legitimately sit
 * at an untagged version — a revert, a hand-edited manifest, the mobile app
 * before this fork ever shipped one — and none of those are a release. Only a
 * merged `chore(release):` commit is, and what makes it one is that it moved
 * `package.json` or `mobile/app.json`.
 *
 * Writes `tags=<space separated>` to $GITHUB_OUTPUT; an empty value means the
 * push was an ordinary change and nothing should be built.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DESKTOP_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$/
const MOBILE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/

/**
 * @param versions {{ desktop, previousDesktop, mobile, previousMobile }} — a
 *   `previous` of null means the file could not be read at the earlier commit,
 *   which is treated as changed: a first push should tag, not stay silent.
 * @param hasTag (name) => boolean
 */
export function pendingReleaseTags(versions, hasTag) {
  const tags = []
  const { desktop, previousDesktop, mobile, previousMobile } = versions

  if (desktop !== previousDesktop) {
    if (!DESKTOP_VERSION.test(desktop)) {
      throw new Error(`package.json version ${desktop} is not X.Y.Z or X.Y.Z-rc.N`)
    }
    if (!hasTag(`v${desktop}`)) {
      tags.push(`v${desktop}`)
    }
  }

  if (mobile !== previousMobile) {
    if (!MOBILE_VERSION.test(mobile)) {
      throw new Error(`mobile/app.json version ${mobile} is not X.Y.Z`)
    }
    // Both platforms read the same marketing version out of mobile/app.json;
    // they have separate tags only so App Store review cannot hold up Android.
    for (const name of [`mobile-ios-v${mobile}`, `mobile-android-v${mobile}`]) {
      if (!hasTag(name)) {
        tags.push(name)
      }
    }
  }

  return tags
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

  const before = process.env.BEFORE ?? ''
  // A dispatch has no before-SHA and a first push reports all zeroes.
  const baseline = /^0*$/.test(before) || before === '' ? 'HEAD^' : before

  const readVersion = (file, pick, ref) => {
    const text =
      ref === null ? readFileSync(path.join(root, file), 'utf8') : git('show', `${ref}:${file}`)
    return pick(JSON.parse(text))
  }
  const atBaseline = (file, pick) => {
    try {
      return readVersion(file, pick, baseline)
    } catch {
      return null
    }
  }

  const desktopOf = (json) => String(json.version)
  const mobileOf = (json) => String(json.expo.version)
  const versions = {
    desktop: readVersion('package.json', desktopOf, null),
    previousDesktop: atBaseline('package.json', desktopOf),
    mobile: readVersion('mobile/app.json', mobileOf, null),
    previousMobile: atBaseline('mobile/app.json', mobileOf)
  }

  const tags = pendingReleaseTags(versions, (name) => git('tag', '--list', name) !== '')
  console.log(
    `desktop ${versions.previousDesktop ?? '?'} → ${versions.desktop} · ` +
      `mobile ${versions.previousMobile ?? '?'} → ${versions.mobile}`
  )
  console.log(tags.length > 0 ? `pending: ${tags.join(' ')}` : 'pending: none')
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tags=${tags.join(' ')}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`✗ ${error.message}`)
    process.exit(1)
  }
}
