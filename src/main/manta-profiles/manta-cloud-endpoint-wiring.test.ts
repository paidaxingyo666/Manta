import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { execFileSync } from 'node:child_process'

/**
 * The self-hosted relay is configured in Settings, and exactly one line carries
 * that setting into the auth config:
 *
 *   setMantaCloudEndpointOverrideSource(() => state.store?.getSettings().mantaCloudEndpoints ?? null)
 *
 * `readEndpointOverrides` defaults to `() => null`, so without that call
 * `getMantaCloudAuthConfig()` reports "not configured" — and the startup path
 * then skips `DesktopRelayService` entirely, inside an `if`, with no warning.
 * The phone keeps dialling the relay, finds no host, and retries forever.
 *
 * That is what happened: upstream moved this startup block from `index.ts` into
 * `startup/main-process-ready-foundation.ts`, the fork's line did not travel
 * with it, and the desktop stopped reaching the relay the moment the release
 * carrying that sync installed itself. Nothing failed loudly; the setting simply
 * stopped being read.
 */

const projectDir = resolve(import.meta.dirname, '../../..')
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' }).trim()

/** Production callers — the definition and the test-only reset do not count. */
function productionCallers(): string[] {
  return git('grep', '-l', 'setMantaCloudEndpointOverrideSource(', '--', 'src/main')
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.endsWith('.test.ts'))
    .filter((file) => !file.endsWith('profile-cloud-auth-config.ts'))
}

describe('Manta cloud endpoint wiring', () => {
  it('is installed by the startup path, not merely exported', () => {
    // An injected setter with no caller is a feature that is off and says
    // nothing. Naming the file keeps the failure message actionable when
    // upstream moves the startup block again.
    expect(productionCallers()).toEqual(['src/main/startup/main-process-ready-foundation.ts'])
  })

  it('reads the setting the Settings pane writes', () => {
    // The two halves have to agree on the field name; a rename on either side
    // would leave the reader returning undefined, which is the same silence.
    const wiring = readFileSync(
      join(projectDir, 'src/main/startup/main-process-ready-foundation.ts'),
      'utf8'
    )
    expect(wiring).toContain('getSettings().mantaCloudEndpoints')
    expect(readFileSync(join(projectDir, 'src/shared/manta-cloud-endpoints.ts'), 'utf8')).toContain(
      'relayDirectorUrl'
    )
  })
})
