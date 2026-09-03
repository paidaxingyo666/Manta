import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { highestRcForBase } from './release-rc-history.mjs'
import { latestStableDesktopReleaseTag } from './latest-stable-release.mjs'
import { bumpMobileAppConfig, upstreamMobileVersion } from './cut-fork-release.mjs'
import { draftReleaseNotes } from './release-notes-draft.mjs'

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

describe('mobile release version', () => {
  it('takes upstream’s newest mobile release, not the newest listed', () => {
    const releases = [
      { tag_name: 'v1.4.196' },
      { tag_name: 'mobile-android-v0.0.9' },
      { tag_name: 'mobile-android-v0.0.47' },
      { tag_name: 'mobile-android-v0.0.46' },
      { tag_name: 'mobile-ios-v0.0.48' }
    ]
    // 0.0.9 sorts above 0.0.47 as a string, and iOS ships to TestFlight without
    // a GitHub release, so only the Android tags name a version that has shipped.
    expect(upstreamMobileVersion(releases)).toBe('0.0.47')
  })

  it('is null when upstream has published no mobile release', () => {
    expect(upstreamMobileVersion([{ tag_name: 'v1.4.196' }])).toBe(null)
  })
})

describe('release notes', () => {
  const up = (subject) => ({ subject, upstream: true })
  const fork = (subject) => ({ subject, upstream: false })
  const subjects = [
    up('fix(ssh): reconnect after the relay drops (#101)'),
    up('fix(ssh): keep the host verdict when contact is lost'),
    up('fix(terminal): stop eating the last line'),
    up('feat(browser): open links in the built-in browser'),
    fork('sync: 120 upstream commits (#14)'),
    fork('chore(release): cut 1.4.195-rc.0'),
    fork('feat(sync): refresh patch hashes in finish'),
    up('docs: tidy the readme'),
    up('not a conventional commit')
  ]

  it('names the biggest subsystems and lists features', () => {
    expect(draftReleaseNotes(subjects, '1.4.196-rc.0', '1.4.196')).toBe(
      [
        '# 1.4.196-rc.0',
        '',
        "Picks up upstream's work through v1.4.196.",
        '',
        '- SSH and remote hosts — 2 fixes',
        '- Terminal — 1 fix',
        '- New: open links in the built-in browser',
        ''
      ].join('\n')
    )
  })

  it('carries no personal identifiers from commit subjects it drops', () => {
    const notes = draftReleaseNotes(subjects, '1.4.196-rc.0', '1.4.196')
    expect(notes).not.toMatch(/#\d+/)
    expect(notes.split('\n').filter((line) => line.startsWith('- ')).length).toBeLessThanOrEqual(8)
  })

  it('leaves the fork’s own sync plumbing out of the news', () => {
    // `feat(sync): …` is this fork's tooling. Announcing it as a feature of the
    // release tells a user about work that changed nothing they can see.
    const notes = draftReleaseNotes(subjects, '1.4.196-rc.0', '1.4.196')
    expect(notes).not.toContain('patch hashes')
    expect(notes).not.toContain('120 upstream commits')
  })

  it('falls back to a count when nothing is scoped', () => {
    expect(
      draftReleaseNotes([up('fix: something'), up('chore: other')], '1.0.0-rc.0', '1.0.0')
    ).toContain('- 2 changes')
  })

  it('says so when a release carries no upstream work', () => {
    const notes = draftReleaseNotes(
      [fork('fix(ci): the stub CLI must name the packaged skill')],
      '1.4.196-rc.1',
      '1.4.196'
    )
    expect(notes).toContain('Fork-only changes; upstream is unchanged')
  })
})

describe('mobile app config bump', () => {
  // The shape that matters: a single-line array the repo's formatter keeps
  // single-line. JSON.parse + JSON.stringify expands it to six lines, and
  // app.json is a file upstream edits, so the noise returns as a sync conflict.
  const config = [
    '{',
    '  "expo": {',
    '    "name": "Manta",',
    '    "version": "0.0.44",',
    '    "ios": {',
    '      "infoPlist": {',
    '        "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]',
    '      }',
    '    },',
    '    "android": {',
    '      "versionCode": 13',
    '    }',
    '  }',
    '}',
    ''
  ].join('\n')

  it('changes two lines and nothing else', () => {
    const bumped = bumpMobileAppConfig(config, '0.0.47')
    const changed = bumped.split('\n').filter((line, i) => line !== config.split('\n')[i])
    expect(changed).toEqual(['    "version": "0.0.47",', '      "versionCode": 14'])
    expect(bumped).toContain('"NSPrivacyAccessedAPITypeReasons": ["CA92.1"]')
  })

  it('counts versionCode up, never resetting it for a new version', () => {
    // Android refuses to install an APK numbered below the one on the device.
    expect(bumpMobileAppConfig(config, '1.0.0')).toContain('"versionCode": 14')
  })

  it('refuses a file where the field is not unique', () => {
    // A plugin block carrying its own pinned version would otherwise get the
    // app's version written into it, silently.
    const ambiguous = config.replace(
      '"name": "Manta",',
      '"plugins": [["expo-build-properties", { "version": "1.2.3" }]],'
    )
    expect(() => bumpMobileAppConfig(ambiguous, '0.0.47')).toThrow(/matched 2 times/)
  })
})
