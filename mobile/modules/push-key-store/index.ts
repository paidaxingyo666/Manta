/**
 * Publishes the push decryption key to the keychain group the notification
 * service extension reads.
 *
 * Optional on purpose: a build without the module — Android, a simulator, an
 * older install — simply has no key to publish, and the push falls back to the
 * generic text the desktop already sends.
 *
 * Resolved lazily rather than at import time. expo-modules-core reaches
 * react-native, whose Flow source the test runner cannot parse, so a top-level
 * import would take every test that transitively touches notifications with it.
 */
type PushKeyStore = {
  setKey: (keyB64: string) => boolean
  getKey: () => string | null
  hasKey: () => boolean
}

function native(): PushKeyStore | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('expo-modules-core') as {
      requireOptionalNativeModule: <T>(name: string) => T | null
    }
    return core.requireOptionalNativeModule<PushKeyStore>('PushKeyStore')
  } catch {
    return null
  }
}

/** Tells a missing native module apart from a module that refused the write. */
export function isPushKeyStoreLinked(): boolean {
  return native() !== null
}

export function publishPushKey(keyB64: string): boolean {
  return native()?.setKey(keyB64) ?? false
}

export function readPublishedPushKey(): string | null {
  return native()?.getKey() ?? null
}
