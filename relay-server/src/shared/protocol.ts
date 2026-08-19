/**
 * Wire constants and helpers shared by the director and the cell.
 *
 * Every value here is dictated by the Manta desktop/mobile clients. Changing one
 * silently breaks pairing, so each is annotated with the client-side source that
 * pins it.
 */
import { createHash, randomBytes } from 'node:crypto'

/** relay-host-proof.ts — domain separator for the challenge plaintext. */
export const HOST_CHALLENGE_DOMAIN = 'manta-relay-host-challenge/v1'
/** relay-host-proof.ts — protocol field value and ack MAC domain. */
export const HOST_PROOF_PROTOCOL = 'manta-relay-host-proof/v1'
/** relay-host-proof.ts — the transcript must carry exactly this many fields. */
export const HOST_PROOF_FIELD_COUNT = 16
/** relay-host-proof.ts — max challenge lifetime and tolerated clock skew. */
export const HOST_CHALLENGE_MAX_LIFETIME_MS = 10_000
export const HOST_CHALLENGE_MAX_SKEW_MS = 30_000

/** relay-control-silence-watchdog.ts — clients terminate after 75s of silence. */
export const CONTROL_PING_INTERVAL_MS = 15_000
export const CONTROL_SILENCE_TIMEOUT_MS = 75_000

/** relay-session-broker.ts — control frames are small; data frames are not. */
export const CONTROL_MAX_PAYLOAD_BYTES = 64 * 1024
export const DATA_MAX_PAYLOAD_BYTES = 1024 * 1024

/**
 * mobile-relay-pairing-offer.ts — a phone rejects an invite whose expiry is more
 * than 10 minutes out (with 30s skew tolerance), so never mint a longer one.
 */
export const INVITE_MAX_LIFETIME_MS = 10 * 60_000

/** mobile-relay-close-codes.ts — the recovery action each code triggers. */
export const CLOSE_CODES = {
  /** Phone permanently disables the credential version. Most costly to misfire. */
  BAD_OUTER_CREDENTIAL: 4401,
  /** Phone retries in 5–15s. */
  HOST_OFFLINE: 4404,
  /** Phone reconnects and rebuilds a fresh E2EE session. */
  PEER_DROPPED: 4408,
  /** Phone re-resolves through the director. */
  WRONG_CELL: 4409,
  /** Phone backs off with full jitter. */
  LIMIT_EXCEEDED: 4429,
  /** Phone re-resolves the configured director. */
  DRAINING: 4503
} as const

/** 32 random bytes as unpadded base64url — 43 chars. */
export function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * mobile-relay-credential-hash.ts — the digest is taken over the *base64url
 * text* of the token, not over the raw random bytes. An early client version got
 * this wrong; matching the current behaviour is mandatory.
 */
export function hashCredential(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

/**
 * relay-http-client.ts — any party holding the desktop public key derives the
 * same id, so a cell must never allocate one itself.
 */
export function deriveRelayHostId(hostPublicKey: Buffer): string {
  return createHash('sha256').update(hostPublicKey).digest('base64url').slice(0, 16)
}

export const RELAY_HOST_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const STANDARD_B64_32_PATTERN = /^[A-Za-z0-9+/]{43}=$/

/** A canonical origin: scheme + host only, no path, query, or fragment. */
export function isCanonicalHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value.replace(/\/$/, '')
  } catch {
    return false
  }
}
