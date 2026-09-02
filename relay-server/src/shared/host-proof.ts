/**
 * Server side of the relay host challenge.
 *
 * Mirrors src/main/runtime/relay/relay-host-proof.ts in the Manta client. The
 * client validates every field byte-for-byte and reports failures only by name,
 * so a mismatch here surfaces as "the desktop can never connect" with almost no
 * diagnostic. Treat this file as protocol, not as implementation detail.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import nacl from 'tweetnacl'
import {
  HOST_CHALLENGE_DOMAIN,
  HOST_CHALLENGE_MAX_LIFETIME_MS,
  HOST_PROOF_PROTOCOL
} from './protocol.js'

const encoder = new TextEncoder()

export type HostProofIdentity = {
  /** All three are compared byte-for-byte against the desktop's local profile. */
  userId: string
  profileId: string
  /** Empty string when the user has no organization — not omitted. */
  organizationId: string
}

export type HostChallengeInput = {
  relayOrigin: string
  relayHostId: string
  hostPublicKey: Buffer
  assignmentEpoch: number
  /** Undefined when the host is not resuming; encoded as a zero-length value. */
  previousGeneration?: number
  resumeRequested: boolean
  identity: HostProofIdentity
  now?: number
}

export type HostChallenge = {
  challengeId: string
  relayEphemeralPublicKeyB64: string
  nonceB64: string
  ciphertextB64: string
  expiresAt: number
}

export type PendingHostChallenge = {
  message: HostChallenge
  /** Retained to verify the ack MAC; never leaves the process. */
  secret: Buffer
  transcript: Buffer
  expiresAt: number
}

function uint32(value: number): Buffer {
  const out = Buffer.allocUnsafe(4)
  out.writeUInt32BE(value, 0)
  return out
}

function uint64(value: number): Buffer {
  // Callers validate, but this is the last stop before writeBigUInt64BE throws
  // — and it throws inside a WebSocket callback, which ends the process.
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`uint64 field out of range: ${value}`)
  }
  const out = Buffer.allocUnsafe(8)
  out.writeBigUInt64BE(BigInt(value), 0)
  return out
}

/** Length-prefixed TLV: uint32BE(nameLen)||name||uint32BE(valueLen)||value. */
function encodeTranscript(fields: [string, Buffer][]): Buffer {
  const parts: Buffer[] = []
  for (const [name, value] of fields) {
    const nameBytes = Buffer.from(name, 'utf8')
    parts.push(uint32(nameBytes.byteLength), nameBytes, uint32(value.byteLength), value)
  }
  return Buffer.concat(parts)
}

/**
 * Builds the 16-field transcript. The client rejects the whole handshake unless
 * `fields.size === 16`, so `previousGeneration` is always present — carrying a
 * zero-length value when the host is not resuming.
 */
export function buildHostProofTranscript(
  input: HostChallengeInput,
  challengeId: string,
  relayEphemeralPublicKey: Buffer,
  nonce: Buffer,
  issuedAt: number,
  expiresAt: number
): Buffer {
  return encodeTranscript([
    ['protocol', Buffer.from(HOST_PROOF_PROTOCOL, 'utf8')],
    ['version', Buffer.from([1])],
    ['relayOrigin', Buffer.from(input.relayOrigin, 'utf8')],
    ['relayEphemeralPublicKey', relayEphemeralPublicKey],
    ['challengeNonce', nonce],
    ['challengeId', Buffer.from(challengeId, 'utf8')],
    ['userId', Buffer.from(input.identity.userId, 'utf8')],
    ['profileId', Buffer.from(input.identity.profileId, 'utf8')],
    ['organizationId', Buffer.from(input.identity.organizationId, 'utf8')],
    ['relayHostId', Buffer.from(input.relayHostId, 'utf8')],
    ['hostPublicKey', input.hostPublicKey],
    ['assignmentEpoch', uint64(input.assignmentEpoch)],
    [
      'previousGeneration',
      input.previousGeneration === undefined ? Buffer.alloc(0) : uint64(input.previousGeneration)
    ],
    ['resumeRequested', Buffer.from([input.resumeRequested ? 1 : 0])],
    ['issuedAt', uint64(issuedAt)],
    ['expiresAt', uint64(expiresAt)]
  ])
}

/**
 * Seals the challenge to the host's Curve25519 public key.
 *
 * The lifetime must stay within HOST_CHALLENGE_MAX_LIFETIME_MS: the client
 * enforces `expiresAt - issuedAt <= 10s` and tolerates only ±30s of clock skew,
 * so this server must run NTP-synced.
 */
export function createHostChallenge(input: HostChallengeInput): PendingHostChallenge {
  const issuedAt = input.now ?? Date.now()
  const expiresAt = issuedAt + HOST_CHALLENGE_MAX_LIFETIME_MS
  const challengeId = randomUUID()
  const ephemeral = nacl.box.keyPair()
  const relayEphemeralPublicKey = Buffer.from(ephemeral.publicKey)
  const nonce = randomBytes(24)
  const secret = randomBytes(32)
  const transcript = buildHostProofTranscript(
    input,
    challengeId,
    relayEphemeralPublicKey,
    nonce,
    issuedAt,
    expiresAt
  )
  const plaintext = Buffer.concat([
    Buffer.from(`${HOST_CHALLENGE_DOMAIN}\0`, 'utf8'),
    uint32(transcript.byteLength),
    transcript,
    secret
  ])
  const ciphertext = nacl.box(
    plaintext,
    nonce,
    new Uint8Array(input.hostPublicKey),
    ephemeral.secretKey
  )
  if (!ciphertext) {
    throw new Error('failed to seal host challenge')
  }
  return {
    message: {
      challengeId,
      // Why standard base64 (not base64url): the client re-encodes and compares
      // the string, so any other alphabet fails its canonical-form check.
      relayEphemeralPublicKeyB64: relayEphemeralPublicKey.toString('base64'),
      nonceB64: nonce.toString('base64'),
      ciphertextB64: Buffer.from(ciphertext).toString('base64'),
      expiresAt
    },
    secret,
    transcript,
    expiresAt
  }
}

/** The ack MAC the client returns; compared in constant time. */
export function expectedHostProof(pending: PendingHostChallenge): string {
  return createHmac('sha256', pending.secret)
    .update(encoder.encode(`${HOST_PROOF_PROTOCOL}\0ack\0`))
    .update(pending.transcript)
    .digest('base64')
}

export function verifyHostProof(pending: PendingHostChallenge, proofB64: string): boolean {
  const expected = Buffer.from(expectedHostProof(pending), 'utf8')
  const received = Buffer.from(proofB64, 'utf8')
  return expected.byteLength === received.byteLength && timingSafeEqual(expected, received)
}
