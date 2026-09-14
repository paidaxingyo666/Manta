import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The native half of push cannot be tested by running the app: the entitlement
 * is written at signing time, so a missing one is a build that installs fine,
 * registers for nothing, and reports no error anywhere. This is the only place
 * that failure is visible before a TestFlight round trip.
 */
const expo = JSON.parse(readFileSync(join(__dirname, '../../app.json'), 'utf8')).expo
// Expo prebuild applies app.config.js on top of app.json, so its output is what gets signed.
const resolveExpoConfig = createRequire(import.meta.url)('../../app.config.js')

function resolvedNotificationsPlugin(config: {
  plugins?: unknown[]
}): Record<string, unknown> | undefined {
  const entry = (config.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications'
  )
  return Array.isArray(entry) ? entry[1] : undefined
}

describe('resolved Expo config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // The relay only speaks production APNs; a build that forgets the variable must
  // not mint sandbox tokens every push to which fails silently.
  it('signs production when ORCA_IOS_APS_ENVIRONMENT is unset', () => {
    vi.stubEnv('ORCA_IOS_APS_ENVIRONMENT', undefined)
    const config = resolveExpoConfig({ config: expo })

    expect(config.ios.entitlements['aps-environment']).toBe('production')
    expect(resolvedNotificationsPlugin(config)?.mode).toBe('production')
  })

  it('uses development only when explicitly requested', () => {
    vi.stubEnv('ORCA_IOS_APS_ENVIRONMENT', 'development')
    const config = resolveExpoConfig({ config: expo })

    expect(config.ios.entitlements['aps-environment']).toBe('development')
    expect(resolvedNotificationsPlugin(config)?.mode).toBe('development')
  })
})

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
