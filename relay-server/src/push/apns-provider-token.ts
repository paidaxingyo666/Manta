import { createSign, createPrivateKey, type KeyObject } from 'node:crypto'

/**
 * The provider token (JWT) that authenticates this relay to APNs.
 *
 * Apple's rules are unusually specific and both directions are enforced: a token
 * older than 60 minutes is rejected, and minting a new one more often than once
 * per 20 minutes gets the connection throttled with TooManyProviderTokenUpdates.
 * So this caches and refreshes on a window between the two rather than signing
 * per request.
 */

/** Apple rejects tokens older than this. */
const MAX_AGE_MS = 60 * 60_000
/** Refresh here — comfortably inside the 60-minute limit, outside the 20-minute floor. */
const REFRESH_AFTER_MS = 45 * 60_000

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export type ApnsCredentials = {
  /** The .p8 contents. */
  privateKey: string | KeyObject
  /** The 10-character Key ID, the XXXXXXXXXX in AuthKey_XXXXXXXXXX.p8. */
  keyId: string
  /** The 10-character Apple Developer Team ID. */
  teamId: string
}

export class ApnsProviderToken {
  private readonly key: KeyObject
  private cached: { token: string; issuedAtMs: number } | null = null

  constructor(
    private readonly credentials: ApnsCredentials,
    private readonly now: () => number = Date.now
  ) {
    this.key =
      typeof credentials.privateKey === 'string'
        ? createPrivateKey(credentials.privateKey)
        : credentials.privateKey
    if (this.key.asymmetricKeyType !== 'ec') {
      throw new Error('APNs auth keys are EC (P-256); this key is not')
    }
  }

  value(): string {
    const nowMs = this.now()
    if (this.cached && nowMs - this.cached.issuedAtMs < REFRESH_AFTER_MS) {
      return this.cached.token
    }
    const token = this.sign(Math.floor(nowMs / 1000))
    this.cached = { token, issuedAtMs: nowMs }
    return token
  }

  /** True when the cached token would be rejected outright rather than merely stale. */
  isExpired(): boolean {
    return !this.cached || this.now() - this.cached.issuedAtMs >= MAX_AGE_MS
  }

  /** Drops the cache so the next value() re-signs — for a 403 InvalidProviderToken. */
  invalidate(): void {
    this.cached = null
  }

  private sign(issuedAtSeconds: number): string {
    const header = base64url(
      JSON.stringify({ alg: 'ES256', kid: this.credentials.keyId, typ: 'JWT' })
    )
    const payload = base64url(
      JSON.stringify({ iss: this.credentials.teamId, iat: issuedAtSeconds })
    )
    const signer = createSign('SHA256')
    signer.update(`${header}.${payload}`)
    // Why ieee-p1363: Node signs EC as DER by default, but JOSE requires the raw
    // r||s pair. A DER signature here is accepted by every local check and
    // rejected by Apple as InvalidProviderToken — the failure names the key,
    // not the encoding, which is why this line is the one to look at first.
    const signature = signer.sign({ key: this.key, dsaEncoding: 'ieee-p1363' })
    return `${header}.${payload}.${base64url(signature)}`
  }
}
