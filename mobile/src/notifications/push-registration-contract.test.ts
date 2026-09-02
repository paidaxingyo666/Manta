import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The native half of push cannot be tested by running the app: the entitlement
 * is written at signing time, so a missing one is a build that installs fine,
 * registers for nothing, and reports no error anywhere. This is the only place
 * that failure is visible before a TestFlight round trip.
 */
const expo = JSON.parse(readFileSync(join(__dirname, '../../app.json'), 'utf8')).expo

describe('iOS push configuration', () => {
  it('declares the APNs entitlement, without which registration silently no-ops', () => {
    expect(expo.ios?.entitlements?.['aps-environment']).toBe('production')
  })

  // TestFlight and the App Store both use the production APNs environment. A
  // `development` entitlement mints sandbox tokens that api.push.apple.com
  // rejects with BadDeviceToken.
  it('targets production, not development', () => {
    expect(expo.ios?.entitlements?.['aps-environment']).not.toBe('development')
  })

  it('includes the notifications plugin so prebuild wires the native module', () => {
    const names = (expo.plugins ?? []).map((p: unknown) => (Array.isArray(p) ? p[0] : p))
    expect(names).toContain('expo-notifications')
  })

  it('keeps the bundle id the relay pushes to', () => {
    // The relay sends apns-topic; a mismatch is rejected as DeviceTokenNotForTopic.
    expect(expo.ios?.bundleIdentifier).toBe('cn.sh.manta.mobile')
  })
})
