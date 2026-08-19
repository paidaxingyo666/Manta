/**
 * Relay tokens.
 *
 * The desktop treats these as opaque strings and never parses them, so the
 * format is ours to choose. What matters is that the cell can recover the
 * identity triple offline — the desktop signs those three values into its host
 * proof and compares them byte-for-byte against its local profile.
 *
 * Format: base64url(payload).base64url(HMAC-SHA256(secret, payload))
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type RelayTokenClaims = {
  userId: string
  profileId: string
  /** Empty string when the user has no organization — never omitted. */
  organizationId: string
  /** Binds the token to one host so it cannot be replayed for another. */
  relayHostId?: string
  expiresAt: number
}

export type RelayTokenVerifier = (token: string) => RelayTokenClaims | null

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function issueRelayToken(claims: RelayTokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function createRelayTokenVerifier(
  secret: string,
  now = () => Date.now()
): RelayTokenVerifier {
  return (token) => {
    const dot = token.indexOf('.')
    if (dot <= 0) {
      return null
    }
    const payload = token.slice(0, dot)
    const provided = Buffer.from(token.slice(dot + 1), 'utf8')
    const expected = Buffer.from(sign(payload, secret), 'utf8')
    if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
      return null
    }
    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8')
      ) as RelayTokenClaims
      if (typeof claims.userId !== 'string' || typeof claims.profileId !== 'string') {
        return null
      }
      if (typeof claims.organizationId !== 'string' || typeof claims.expiresAt !== 'number') {
        return null
      }
      return claims.expiresAt > now() ? claims : null
    } catch {
      return null
    }
  }
}
