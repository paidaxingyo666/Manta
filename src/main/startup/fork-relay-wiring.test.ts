import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The fork's relay integration is a set of injection points: something upstream
 * defines a setter, and one fork-only line at startup calls it. Twice now a
 * sync has taken upstream's side of a restructured startup file and left those
 * calls behind — and neither time did anything fail.
 *
 * An orphaned *import* is a compile error. An orphaned *call* is a feature that
 * is off and says nothing:
 *
 *   - the endpoint override went missing and the desktop stopped reaching the
 *     relay entirely, because getMantaCloudAuthConfig() then reports "not
 *     configured" and the startup path skips DesktopRelayService inside an `if`;
 *   - the push escalation went missing and the phone was only reachable while
 *     its app was in the foreground, because nothing ever called pushWake.
 *
 * So each of these is pinned by its *caller*, not by its export. The list is
 * short on purpose: it is the wiring that carries a whole feature and that
 * upstream has no reason to keep.
 */

const projectDir = resolve(import.meta.dirname, '../../..')

/** Files under src/ that call `symbol`, excluding tests and its own definition. */
function productionCallers(symbol: string, definedIn: string): string[] {
  // --untracked: a wiring file added but not yet committed still counts, or the
  // check passes on the very change that would have broken it.
  const out = execFileSync('git', ['grep', '-l', '--untracked', `${symbol}(`, '--', 'src/'], {
    cwd: projectDir,
    encoding: 'utf8'
  }).trim()
  return out
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
    .filter((file) => file !== definedIn)
}

const WIRING = [
  {
    what: 'self-hosted relay endpoints reach the auth config',
    symbol: 'setMantaCloudEndpointOverrideSource',
    definedIn: 'src/main/manta-profiles/profile-cloud-auth-config.ts',
    calledFrom: 'src/main/startup/main-process-ready-foundation.ts'
  },
  {
    what: 'a backgrounded phone is woken by APNs',
    symbol: 'new MobilePushEscalation',
    definedIn: 'src/main/runtime/mobile-push-escalation.ts',
    calledFrom: 'src/main/startup/desktop-relay-startup.ts'
  },
  {
    what: 'this machine appears in the relay directory',
    symbol: 'publishThisMachineToRelay',
    definedIn: 'src/main/runtime/relay/relay-host-directory.ts',
    calledFrom: 'src/main/startup/desktop-relay-startup.ts'
  },
  {
    what: 'the directory can read this host id without a broker',
    symbol: 'setRelayHostIdentityReader',
    definedIn: 'src/main/runtime/relay/relay-host-directory.ts',
    calledFrom: 'src/main/startup/desktop-relay-startup.ts'
  }
]

describe('fork relay wiring', () => {
  it.each(WIRING)('$what', ({ symbol, definedIn, calledFrom }) => {
    // Naming the expected file keeps the failure actionable when upstream moves
    // the startup block again — which is how both of these were lost.
    expect(productionCallers(symbol, definedIn)).toContain(calledFrom)
  })

  it('wakes the phone through the relay it just built', () => {
    // pushWake is reached only through DesktopRelayService, so the escalation
    // and the service have to be constructed in the same place; a split would
    // leave `wake` pointing at a service that does not exist yet.
    const startup = readFileSync(
      join(projectDir, 'src/main/startup/desktop-relay-startup.ts'),
      'utf8'
    )
    expect(startup).toContain('relayService.pushWake(input)')
    expect(startup).toContain('new DesktopRelayService(')
  })
})
