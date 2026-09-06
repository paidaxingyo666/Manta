import { describe, expect, it } from 'vitest'
import {
  browserRouteTcpEgressProbeIsRunnable,
  runBrowserRouteTcpEgressProbe
} from './browser-route-tcp-egress-fixture'

const EXPECTED_PATHS = ['/asset', '/download', '/page', '/redirect', '/secure', '/socket']

describe('browser route TCP egress under Electron', () => {
  it('routes browser TCP surfaces and remote DNS through the fixed SOCKS session', async (ctx) => {
    // The proof is that the target has no local answer: if it resolves here,
    // Chromium could have reached it directly and observing SOCKS proves
    // nothing. A resolver that answers every name — a VPN's fake-IP range does
    // exactly that for `.test` — leaves this nothing to observe, which is a
    // fact about the machine rather than a defect in the routing.
    if (!(await browserRouteTcpEgressProbeIsRunnable())) {
      ctx.skip('remote-browser.test resolves on this machine; DNS egress is unobservable')
      return
    }
    const baseline = await runBrowserRouteTcpEgressProbe(false)
    const protectedSession = await runBrowserRouteTcpEgressProbe(true)

    expect(baseline.resolvedProxy).toBe('DIRECT')
    expect(baseline.directPaths).toEqual(EXPECTED_PATHS)
    expect(baseline.routedPaths).toEqual([])
    expect(protectedSession.resolvedProxy).toMatch(/^SOCKS5 127\.0\.0\.1:\d+$/)
    expect(protectedSession.directPaths).toEqual([])
    expect(protectedSession.routedPaths).toEqual(EXPECTED_PATHS)
    // Chromium may route an unrelated background request through the same proxy.
    // The target-host observation is the causal DNS/routing oracle for this fixture.
    expect(protectedSession.socksHosts).toContain('remote-browser.test')
  }, 60_000)
})
