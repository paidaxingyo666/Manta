import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSkillPackageDownloadOrigins } from './skill-package-download-origins'

const BUCKET = 'https://storage.googleapis.com'

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * This list decides which host may hand this machine an archive that is
 * unpacked into a skill directory and run by an agent, so every case here is
 * about what must NOT get in.
 */
describe('resolveSkillPackageDownloadOrigins', () => {
  it('keeps upstream bucket as the default', () => {
    expect(resolveSkillPackageDownloadOrigins({ env: {} })).toEqual([BUCKET])
  })

  // Upstream honoured this in development builds only, which left a
  // self-hosting operator failing at the download after a successful review.
  it('honours an operator origin without asking whether the build is packaged', () => {
    expect(
      resolveSkillPackageDownloadOrigins({
        env: { MANTA_SKILL_PACKAGE_DOWNLOAD_ORIGINS: 'https://skills.example.com' }
      })
    ).toEqual([BUCKET, 'https://skills.example.com'])
  })

  it('accepts several origins and drops duplicates', () => {
    expect(
      resolveSkillPackageDownloadOrigins({
        env: {
          MANTA_SKILL_PACKAGE_DOWNLOAD_ORIGINS: `https://a.example, https://b.example, ${BUCKET}`
        }
      })
    ).toEqual([BUCKET, 'https://a.example', 'https://b.example'])
  })

  it.each([
    ['plain http to a remote host', 'http://skills.example.com'],
    ['a path', 'https://skills.example.com/packages'],
    ['a query string', 'https://skills.example.com?token=1'],
    ['embedded credentials', 'https://user:pw@skills.example.com'],
    ['a fragment', 'https://skills.example.com#x'],
    ['nonsense', 'not-a-url'],
    ['a non-http scheme', 'file:///tmp/packages']
  ])('refuses %s', (_label, origin) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(
      resolveSkillPackageDownloadOrigins({
        env: { MANTA_SKILL_PACKAGE_DOWNLOAD_ORIGINS: origin }
      })
    ).toEqual([BUCKET])
  })

  it('says so rather than silently dropping a rejected origin', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    resolveSkillPackageDownloadOrigins({
      env: { MANTA_SKILL_PACKAGE_DOWNLOAD_ORIGINS: 'http://skills.example.com' }
    })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('http://skills.example.com'))
  })

  // One bad entry must not take the whole feature down with it.
  it('keeps the valid entries when one is malformed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(
      resolveSkillPackageDownloadOrigins({
        env: { MANTA_SKILL_PACKAGE_DOWNLOAD_ORIGINS: 'https://ok.example, http://bad.example' }
      })
    ).toEqual([BUCKET, 'https://ok.example'])
  })

  it('allows loopback http only where the caller permits it', () => {
    const env = { MANTA_SKILL_PACKAGE_DOWNLOAD_ORIGINS: 'http://127.0.0.1:8080' }

    expect(resolveSkillPackageDownloadOrigins({ env, allowLoopbackHttp: true })).toEqual([
      BUCKET,
      'http://127.0.0.1:8080'
    ])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveSkillPackageDownloadOrigins({ env })).toEqual([BUCKET])
  })
})
