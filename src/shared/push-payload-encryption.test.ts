import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decryptPushBody,
  encryptPushBody,
  generatePushKey,
  PUSH_KEY_BYTES,
  type EncryptedPushBody
} from './push-payload-encryption'

const KEY = generatePushKey()

describe('push body encryption', () => {
  it('round-trips text', () => {
    const sealed = encryptPushBody(KEY, 'worktree fix-login 的 agent 需要确认')

    expect(decryptPushBody(KEY, sealed)).toBe('worktree fix-login 的 agent 需要确认')
  })

  it('generates a key of the size the cipher requires', () => {
    expect(generatePushKey()).toHaveLength(PUSH_KEY_BYTES)
    expect(generatePushKey().equals(generatePushKey())).toBe(false)
  })

  it('refuses a key that is the wrong size rather than truncating one', () => {
    expect(() => encryptPushBody(randomBytes(16), 'x')).toThrow(/32 bytes/)
  })

  // Every rejection returns null, not an error: the extension has one response
  // to all of them — keep the generic text — and a thrown error there is a
  // notification that does not arrive at all.
  it('returns null for the wrong key', () => {
    expect(decryptPushBody(generatePushKey(), encryptPushBody(KEY, 'secret'))).toBeNull()
  })

  it('returns null when the ciphertext was tampered with', () => {
    const sealed = encryptPushBody(KEY, 'secret')
    const raw = Buffer.from(sealed.d, 'base64')
    raw[raw.length - 1] ^= 0xff // flip a bit in the auth tag

    expect(decryptPushBody(KEY, { ...sealed, d: raw.toString('base64') })).toBeNull()
  })

  it.each([
    ['a truncated payload', { v: 1, d: 'AAAA' }],
    ['garbage', { v: 1, d: 'not base64 !!!' }],
    ['an unknown version', { v: 99, d: encryptPushBody(KEY, 'x').d }]
  ])('returns null for %s', (_label, body) => {
    expect(decryptPushBody(KEY, body as EncryptedPushBody)).toBeNull()
  })

  // APNs caps a payload at 4 KB and the rest of the notification shares it.
  it('stays small enough to ride inside an APNs payload', () => {
    const sealed = encryptPushBody(KEY, 'a'.repeat(500))

    expect(JSON.stringify(sealed).length).toBeLessThan(1024)
  })

  it('never repeats a nonce, so the same text seals differently each time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => encryptPushBody(KEY, 'same').d))

    expect(seen.size).toBe(50)
  })
})
