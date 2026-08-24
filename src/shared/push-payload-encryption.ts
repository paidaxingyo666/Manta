import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * The wire format for a push body only the phone can read.
 *
 * AES-256-GCM because it is the one authenticated cipher that both ends already
 * have without a dependency: node:crypto here, CryptoKit's AES.GCM in the
 * notification service extension. Any scheme the extension cannot implement in
 * a few lines is the wrong scheme — that target runs for ~30s with a small
 * memory budget and cannot ship a crypto library of its own.
 *
 * Layout is nonce ‖ ciphertext ‖ tag, base64. Concatenated rather than a JSON
 * object with three fields because the whole thing has to fit inside an APNs
 * payload alongside everything else, and 4 KB is the hard cap.
 */

export const PUSH_ENCRYPTION_VERSION = 1
/** GCM's standard nonce. 12 bytes is what CryptoKit expects without conversion. */
const NONCE_BYTES = 12
const TAG_BYTES = 16
export const PUSH_KEY_BYTES = 32

export type EncryptedPushBody = {
  /** Lets the extension refuse a payload written by a scheme it does not know. */
  v: number
  /** base64(nonce ‖ ciphertext ‖ tag) */
  d: string
}

export function generatePushKey(): Buffer {
  return randomBytes(PUSH_KEY_BYTES)
}

export function encryptPushBody(key: Buffer, plaintext: string): EncryptedPushBody {
  if (key.length !== PUSH_KEY_BYTES) {
    throw new Error(`push key must be ${PUSH_KEY_BYTES} bytes, got ${key.length}`)
  }
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    v: PUSH_ENCRYPTION_VERSION,
    d: Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64')
  }
}

/**
 * The desktop counterpart of what the extension does. Exists so the format is
 * exercised in both directions by tests here rather than only in Swift, where a
 * mismatch surfaces as a notification that silently keeps its generic text.
 */
export function decryptPushBody(key: Buffer, body: EncryptedPushBody): string | null {
  if (body.v !== PUSH_ENCRYPTION_VERSION) {
    return null
  }
  try {
    const raw = Buffer.from(body.d, 'base64')
    if (raw.length <= NONCE_BYTES + TAG_BYTES) {
      return null
    }
    const nonce = raw.subarray(0, NONCE_BYTES)
    const tag = raw.subarray(raw.length - TAG_BYTES)
    const ciphertext = raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // A wrong key, a truncated payload, and a tampered one all land here, and
    // the extension must treat them identically: keep the generic text.
    return null
  }
}
