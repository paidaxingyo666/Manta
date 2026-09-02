import {
  isPushKeyStoreLinked,
  publishPushKey,
  readPublishedPushKey
} from '../../modules/push-key-store'

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
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string }

/**
 * Returns the key to send to the desktop, minting one when there is none.
 *
 * Reported on every connect, never rotated on one. The phone is the only holder
 * — if the desktop loses its copy to a wiped profile or a re-pair, nothing else
 * can tell it what to seal with, and re-sending an unchanged key is free.
 * Rotating instead would make any push sealed moments earlier undecryptable.
 */
export function ensurePushKey(): PushKeyResult {
  // Every step names itself. Folding these into one silent result is what made
  // the first three attempts unfalsifiable from the desktop side: the key was
  // simply absent, with no way to tell a missing module from a failed write.
  if (!isPushKeyStoreLinked()) {
    return { status: 'unavailable', reason: 'native-module-missing' }
  }
  let existing: string | null = null
  try {
    existing = readPublishedPushKey()
  } catch (error) {
    return { status: 'failed', reason: `read: ${message(error)}` }
  }
  if (existing) {
    return { status: 'ready', keyB64: existing }
  }
  let keyB64: string
  try {
    keyB64 = toBase64(randomBytes(KEY_BYTES))
  } catch (error) {
    return { status: 'failed', reason: `generate: ${message(error)}` }
  }
  try {
    return publishPushKey(keyB64)
      ? { status: 'ready', keyB64 }
      : { status: 'failed', reason: 'keychain-write-refused' }
  } catch (error) {
    return { status: 'failed', reason: `write: ${message(error)}` }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)
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

/**
 * Bare btoa, matching transport/e2ee.ts. The earlier version guarded with
 * `global.btoa ?? Buffer` — and Buffer does not exist in React Native, so on any
 * runtime where that guard missed, this threw and the caller reported the key as
 * merely unavailable.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}
