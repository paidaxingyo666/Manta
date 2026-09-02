import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The native half cannot be tested by running anything: the extension only runs
 * on a real device when a push arrives, and every way it can be wrong is
 * silent — a wrong bundle id, a missing entitlement, a keychain group that does
 * not match. These assertions are the only place those disagreements are
 * visible before a TestFlight round trip.
 */
const root = join(__dirname, '../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const APP_GROUP = 'group.cn.sh.manta.mobile'
const NSE_BUNDLE_ID = 'cn.sh.manta.mobile.NotificationService'

describe('notification service extension wiring', () => {
  it('uses one keychain group across the module, the extension and the plugin', () => {
    for (const file of [
      'modules/push-key-store/ios/PushKeyStoreModule.swift',
      'plugins/notification-service/NotificationService.swift',
      'plugins/notification-service/index.js'
    ]) {
      expect(read(file)).toContain(APP_GROUP)
    }
  })

  it('agrees on the keychain service and account either side reads', () => {
    const module = read('modules/push-key-store/ios/PushKeyStoreModule.swift')
    const extension_ = read('plugins/notification-service/NotificationService.swift')

    for (const value of ['cn.sh.manta.mobile.push', 'push-key']) {
      expect(module).toContain(value)
      expect(extension_).toContain(value)
    }
  })

  // iOS refuses to install an extension whose bundle id does not extend its
  // host app's, and Apple issues a separate profile per App ID.
  it('registers the extension bundle id with the build', () => {
    expect(read('fastlane/Fastfile')).toContain(NSE_BUNDLE_ID)
    expect(NSE_BUNDLE_ID.startsWith('cn.sh.manta.mobile.')).toBe(true)
  })

  it('signs the extension as its own target', () => {
    const fastfile = read('fastlane/Fastfile')

    expect(fastfile).toContain('NSE_BUNDLE_ID => nse_profile_name')
    // A bare specifier applies to every target and points the extension at the
    // app's profile.
    expect(fastfile).not.toContain("PROVISIONING_PROFILE_SPECIFIER='#{profile_name}'")
  })

  it('keeps the app group on the app as well as the extension', () => {
    const plugin = read('plugins/notification-service/index.js')

    expect(plugin).toContain('com.apple.security.application-groups')
    expect(plugin).toContain('keychain-access-groups')
  })

  /**
   * Xcode archives an extension whose Info.plist omits CFBundleExecutable
   * without complaint; App Store Connect rejects the upload with 90171,
   * "Invalid bundle structure", because the binary inside reads as a standalone
   * executable. Forty minutes of build time to find out.
   */
  it('declares the keys App Store Connect validates on upload', () => {
    const plugin = read('plugins/notification-service/index.js')

    for (const key of [
      'CFBundleExecutable',
      'CFBundleDevelopmentRegion',
      'CFBundleInfoDictionaryVersion',
      'CFBundlePackageType'
    ]) {
      expect(plugin).toContain(key)
    }
  })

  // The payload field and version the desktop writes.
  it('reads the field the desktop actually sends', () => {
    const extension_ = read('plugins/notification-service/NotificationService.swift')

    expect(extension_).toContain('userInfo["mb"]')
    expect(extension_).toContain('version == 1')
  })
})
