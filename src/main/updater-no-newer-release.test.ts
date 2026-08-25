import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A manual check on a version with nothing newer reported that the update server
 * could not be reached.
 *
 * Two faults compounded, and neither is reachable from a unit test without
 * standing up the whole electron-updater flow — so they are pinned here at the
 * source level, which is where a regression would reappear.
 *
 * The preflight fell through to `releases/latest/download`. That URL resolves to
 * the newest STABLE release and skips prereleases, so on a channel that has only
 * ever published prereleases it 404s: a successful "nothing newer" arrived as a
 * transport error. And the message that would have explained it required
 * releaseChannel === 'default', so prerelease users saw the network text.
 *
 * The branch still runs a real check — it pins this build's own release, which
 * exists — so the rest of the flow keeps the behavior upstream's tests assume.
 */
const source = readFileSync(join(__dirname, 'updater.ts'), 'utf8')

describe('preflight when nothing is newer', () => {
  it('guards the releases/latest fallback with a no-newer branch', () => {
    // `} else if` distinguishes this from the perf channel's own no-newer check,
    // which is a plain `if` inside another block — and which also returns
    // not-available, so an assertion that cannot tell them apart passes with the
    // guard deleted.
    const guard = "} else if (releaseTagsResult.state === 'no-newer') {"
    const fallback =
      "const url = 'https://github.com/paidaxingyo666/Manta/releases/latest/download'"

    expect(source).toContain(guard)
    expect(source.indexOf(guard)).toBeLessThan(source.indexOf(fallback))
  })

  it('pins the no-newer path to this build own release, never to releases/latest', () => {
    const guard = "} else if (releaseTagsResult.state === 'no-newer') {"
    const fallback =
      "const url = 'https://github.com/paidaxingyo666/Manta/releases/latest/download'"
    const branch = source.slice(source.indexOf(guard), source.indexOf(fallback))

    // A concrete versioned feed, so electron-updater runs a real comparison and
    // answers "up to date" instead of failing to reach releases/latest.
    expect(branch).toContain('getReleaseDownloadUrl(`v${currentVersion}`)')
    expect(branch).toContain('setFeedURL')
    expect(branch).not.toContain('releases/latest/download')
  })

  // Requiring the default channel meant every prerelease user got the transport
  // message for a condition that has nothing to do with transport.
  it('chooses the message by failure reason, not by release channel', () => {
    const fn = source.slice(
      source.indexOf('function isReleaseNotReadyFailure'),
      source.indexOf('export function getUpdateStatus')
    )

    expect(fn).toContain("reason === 'release-not-ready'")
    expect(fn).not.toContain('releaseChannel')
  })
})
