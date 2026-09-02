/**
 * Interop test: the server-generated challenge must be answerable by the *real*
 * desktop client implementation, and the resulting ack must verify here.
 *
 * The client module is imported straight from the Manta repo so this test fails
 * the moment either side drifts.
 */
import { describe, expect, it } from 'vitest'
import nacl from 'tweetnacl'
import { answerRelayHostChallenge } from '../../../src/main/runtime/relay/relay-host-proof'
import { createHostChallenge, verifyHostProof } from './host-proof.js'
import { deriveRelayHostId } from './protocol.js'

function hostKeys() {
  const pair = nacl.box.keyPair()
  return {
    publicKey: Buffer.from(pair.publicKey),
    secretKey: pair.secretKey
  }
}

const identity = {
  userId: 'user-123',
  profileId: 'profile-456',
  organizationId: ''
}

describe('host challenge interop with the desktop client', () => {
  it('produces a challenge the client answers and the server accepts', () => {
    const host = hostKeys()
    const relayHostId = deriveRelayHostId(host.publicKey)
    const pending = createHostChallenge({
      relayOrigin: 'https://relay.example.com',
      relayHostId,
      hostPublicKey: host.publicKey,
      assignmentEpoch: 7,
      resumeRequested: false,
      identity
    })

    const proof = answerRelayHostChallenge(pending.message, {
      relayOrigin: 'https://relay.example.com',
      userId: identity.userId,
      profileId: identity.profileId,
      organizationId: identity.organizationId,
      relayHostId,
      hostPublicKey: host.publicKey,
      hostSecretKey: host.secretKey,
      assignmentEpoch: 7,
      resumeRequested: false
    })

    expect(proof).not.toBeNull()
    expect(verifyHostProof(pending, proof as string)).toBe(true)
  })

  it('carries previousGeneration when the host resumes', () => {
    const host = hostKeys()
    const relayHostId = deriveRelayHostId(host.publicKey)
    const pending = createHostChallenge({
      relayOrigin: 'https://relay.example.com',
      relayHostId,
      hostPublicKey: host.publicKey,
      assignmentEpoch: 2,
      previousGeneration: 41,
      resumeRequested: true,
      identity
    })
    const proof = answerRelayHostChallenge(pending.message, {
      relayOrigin: 'https://relay.example.com',
      userId: identity.userId,
      profileId: identity.profileId,
      organizationId: identity.organizationId,
      relayHostId,
      hostPublicKey: host.publicKey,
      hostSecretKey: host.secretKey,
      assignmentEpoch: 2,
      previousGeneration: 41,
      resumeRequested: true
    })
    expect(proof).not.toBeNull()
    expect(verifyHostProof(pending, proof as string)).toBe(true)
  })

  it('is rejected by the client when the identity does not match', () => {
    const host = hostKeys()
    const relayHostId = deriveRelayHostId(host.publicKey)
    const pending = createHostChallenge({
      relayOrigin: 'https://relay.example.com',
      relayHostId,
      hostPublicKey: host.publicKey,
      assignmentEpoch: 1,
      resumeRequested: false,
      identity: { ...identity, organizationId: 'org-that-desktop-does-not-have' }
    })
    const reasons: string[] = []
    const proof = answerRelayHostChallenge(pending.message, {
      relayOrigin: 'https://relay.example.com',
      userId: identity.userId,
      profileId: identity.profileId,
      organizationId: '',
      relayHostId,
      hostPublicKey: host.publicKey,
      hostSecretKey: host.secretKey,
      assignmentEpoch: 1,
      resumeRequested: false,
      onInvalid: (reason) => reasons.push(reason)
    })
    expect(proof).toBeNull()
    expect(reasons.join(',')).toContain('organizationId')
  })

  it('is rejected when the relay origin differs', () => {
    const host = hostKeys()
    const relayHostId = deriveRelayHostId(host.publicKey)
    const pending = createHostChallenge({
      relayOrigin: 'https://evil.example.com',
      relayHostId,
      hostPublicKey: host.publicKey,
      assignmentEpoch: 1,
      resumeRequested: false,
      identity
    })
    const proof = answerRelayHostChallenge(pending.message, {
      relayOrigin: 'https://relay.example.com',
      userId: identity.userId,
      profileId: identity.profileId,
      organizationId: identity.organizationId,
      relayHostId,
      hostPublicKey: host.publicKey,
      hostSecretKey: host.secretKey,
      assignmentEpoch: 1,
      resumeRequested: false
    })
    expect(proof).toBeNull()
  })
})
