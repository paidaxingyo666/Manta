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
    expect(source.slice(source.indexOf(guard), source.indexOf(fallback))).toContain(
      "return 'not-available'"
    )
  })

  it('does not pin a feed on the no-newer path', () => {
    const guard = "} else if (releaseTagsResult.state === 'no-newer') {"
    const fallback =
      "const url = 'https://github.com/paidaxingyo666/Manta/releases/latest/download'"

    expect(source.slice(source.indexOf(guard), source.indexOf(fallback))).not.toContain(
      'setFeedURL'
    )
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
