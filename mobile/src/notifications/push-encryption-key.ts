import { publishPushKey, readPublishedPushKey } from '../../modules/push-key-store'

/**
 * The key the desktop seals a push body with and the notification service
 * extension opens it with.
 *
 * Generated here rather than on the desktop because the extension can only read
 * what this app publishes into the shared keychain group — so the phone has to
 * hold it first, and the desktop is told about it second.
 */

const KEY_BYTES = 32

export type PushKeyResult =
  | { status: 'ready'; keyB64: string }
  /** No native module: Android, a simulator, or a build without the extension. */
  | { status: 'unavailable' }
  | { status: 'failed' }

/**
 * Returns the key to send to the desktop, minting one when there is none.
 *
 * Reported on every connect, never rotated on one. The phone is the only holder
 * — if the desktop loses its copy to a wiped profile or a re-pair, nothing else
 * can tell it what to seal with, and re-sending an unchanged key is free.
 * Rotating instead would make any push sealed moments earlier undecryptable.
 */
export function ensurePushKey(): PushKeyResult {
  try {
    const existing = readPublishedPushKey()
    if (existing) {
      return { status: 'ready', keyB64: existing }
    }
    const keyB64 = toBase64(randomBytes(KEY_BYTES))
    return publishPushKey(keyB64) ? { status: 'ready', keyB64 } : { status: 'failed' }
  } catch {
    return { status: 'unavailable' }
  }
}

/**
 * Required lazily for the same reason the native module is: expo-crypto imports
 * expo-modules-core, which reaches react-native, whose Flow source the test
 * runner cannot parse — and a top-level import takes every test that
 * transitively touches notifications down with it.
 */
function randomBytes(count: number): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('expo-crypto') as { getRandomBytes: (n: number) => Uint8Array }
  return crypto.getRandomBytes(count)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  // eslint-disable-next-line no-undef
  return global.btoa ? global.btoa(binary) : Buffer.from(bytes).toString('base64')
}
