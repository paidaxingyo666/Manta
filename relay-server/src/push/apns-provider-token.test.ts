import { createPrivateKey, generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ApnsProviderToken } from './apns-provider-token.js'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const CREDS = { privateKey: PEM, keyId: 'BH9L9MJ2KR', teamId: 'G5J7URYYG5' }

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString())
}

describe('ApnsProviderToken', () => {
  it('signs a JWT Apple will accept the shape of', () => {
    const [header, payload, signature] = new ApnsProviderToken(CREDS).value().split('.')

    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'BH9L9MJ2KR', typ: 'JWT' })
    expect(decode(payload)).toMatchObject({ iss: 'G5J7URYYG5' })
    expect(typeof decode(payload).iat).toBe('number')
    expect(signature).toBeTruthy()
  })

  /**
   * The one that actually bites. Node signs EC as DER unless told otherwise, and
   * JOSE requires raw r||s. Apple rejects a DER signature as
   * InvalidProviderToken — an error that names the key, not the encoding.
   */
  it('emits a raw r||s signature, not DER', () => {
    const [header, payload, signature] = new ApnsProviderToken(CREDS).value().split('.')
    const raw = Buffer.from(signature, 'base64url')

    expect(raw).toHaveLength(64) // P-256: two 32-byte integers, no ASN.1 wrapper
    expect(raw[0]).not.toBe(0x30) // a DER SEQUENCE would start here

    const verifier = createVerify('SHA256')
    verifier.update(`${header}.${payload}`)
    expect(verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(true)
  })

  it('reuses a token rather than re-signing per push', () => {
    const token = new ApnsProviderToken(CREDS)

    expect(token.value()).toBe(token.value())
  })

  // Apple throttles a provider that mints tokens more than once per 20 minutes,
  // and rejects any token older than 60. The refresh window sits between.
  it('re-signs once the token goes stale but before Apple would reject it', () => {
    let now = 1_700_000_000_000
    const token = new ApnsProviderToken(CREDS, () => now)
    const first = token.value()

    now += 19 * 60_000
    expect(token.value()).toBe(first)

    now += 27 * 60_000 // 46 minutes total: past refresh, inside the 60-minute limit
    const second = token.value()
    expect(second).not.toBe(first)
    expect(token.isExpired()).toBe(false)
  })

  it('reports expiry only once Apple would actually reject it', () => {
    let now = 1_700_000_000_000
    const token = new ApnsProviderToken(CREDS, () => now)
    token.value()

    now += 59 * 60_000
    expect(token.isExpired()).toBe(false)
    now += 2 * 60_000
    expect(token.isExpired()).toBe(true)
  })

  it('re-signs after invalidate, so a 403 can recover without a restart', () => {
    let now = 1_700_000_000_000
    const token = new ApnsProviderToken(CREDS, () => now)
    const first = token.value()

    token.invalidate()
    now += 1000
    expect(token.value()).not.toBe(first)
  })

  it('refuses a key that is not EC', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(
      () =>
        new ApnsProviderToken({
          ...CREDS,
          privateKey: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
        })
    ).toThrow(/EC/)
  })

  it('accepts a KeyObject as well as PEM text', () => {
    expect(
      new ApnsProviderToken({ ...CREDS, privateKey: createPrivateKey(PEM) }).value()
    ).toContain('.')
  })
})
