import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { highestRcForBase } from './release-rc-history.mjs'
import { latestStableDesktopReleaseTag } from './latest-stable-release.mjs'

/**
 * The version rule the cut applies, stated once so a change to it fails here
 * rather than on a published tag: follow upstream's newest stable base, never
 * move the base backwards, and take the rc after the highest already cut.
 */
function nextVersion(upstreamBase, currentVersion, highestRc) {
  const currentBase = currentVersion.split('-')[0]
  const gt = (a, b) => {
    const l = a.split('.').map(Number)
    const r = b.split('.').map(Number)
    for (let i = 0; i < 3; i += 1) {
      if ((l[i] ?? 0) !== (r[i] ?? 0)) {
        return (l[i] ?? 0) > (r[i] ?? 0)
      }
    }
    return false
  }
  const base = gt(upstreamBase, currentBase) ? upstreamBase : currentBase
  return `${base}-rc.${highestRc === null ? 0 : highestRc + 1}`
}

describe('fork release version', () => {
  it('moves to upstream’s base and restarts the rc series', () => {
    expect(nextVersion('1.4.196', '1.4.193-rc.0', null)).toBe('1.4.196-rc.0')
  })

  it('takes the next rc when the base has not moved', () => {
    expect(nextVersion('1.4.193', '1.4.193-rc.0', 0)).toBe('1.4.193-rc.1')
    expect(nextVersion('1.4.193', '1.4.193-rc.3', 3)).toBe('1.4.193-rc.4')
  })

  it('never moves the base backwards', () => {
    // A fork-only fix can be cut ahead of upstream; the next sync must not
    // renumber it downwards, which would make the update feed go back in time.
    expect(nextVersion('1.4.190', '1.4.193-rc.1', 1)).toBe('1.4.193-rc.2')
  })

  it('reads the highest rc from history, not from package.json', () => {
    // package.json is a working file and lies after a revert: the rc that was
    // published still exists as a tag, and reusing its number would overwrite it.
    const root = mkdtempSync(join(tmpdir(), 'cut-release-'))
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    git('init', '-q')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'first')
    git('tag', 'v1.4.196-rc.0')
    git('tag', 'v1.4.196-rc.1')

    expect(highestRcForBase('1.4.196', { cwd: root })).toBe(1)
    expect(nextVersion('1.4.196', '1.4.196-rc.0', highestRcForBase('1.4.196', { cwd: root }))).toBe(
      '1.4.196-rc.2'
    )
  })

  it('follows upstream’s stable releases, ignoring their prereleases', () => {
    const releases = [
      { tag_name: 'v1.4.197-rc.1' },
      { tag_name: 'v1.4.196' },
      { tag_name: 'mobile-android-v0.0.47' },
      { tag_name: 'v1.4.195' }
    ]
    expect(latestStableDesktopReleaseTag(releases)).toBe('v1.4.196')
  })
})
