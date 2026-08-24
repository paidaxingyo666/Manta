import { answerRelayHostChallenge } from './relay-host-proof'
import {
  RelayHostChallengeMessageSchema,
  RelayHostHelloAckMessageSchema,
  type RelayHostHelloAckMessage
} from './relay-control-protocol'

/**
 * The two frames that finish a control handshake: the relay's identity
 * challenge, and its acknowledgement.
 *
 * Split out of RelayControlClient because it is the one part of that class that
 * is about proving who we are rather than about running a connection — and
 * because a connection class should not grow crypto every time a control frame
 * is added.
 */

export type ChallengeExchangeInput = {
  message: Record<string, unknown>
  relayOrigin: string
  identity: Record<string, unknown>
  relayHostId: string
  hostPublicKey: Uint8Array
  hostSecretKey: Uint8Array
  assignmentEpoch: number
  previousGeneration: number | undefined
  resumeRequested: boolean
}

export type ChallengeExchangeResult =
  | { kind: 'answer'; frame: string }
  | { kind: 'accepted'; ack: RelayHostHelloAckMessage }
  /** Reason names the failing check only; field values never surface. */
  | { kind: 'invalid'; reason: string }

export function respondToRelayHostChallenge(
  input: ChallengeExchangeInput
): ChallengeExchangeResult {
  const challenge = RelayHostChallengeMessageSchema.safeParse(input.message)
  if (challenge.success) {
    let invalidReason = 'unknown'
    const proofB64 = answerRelayHostChallenge(challenge.data, {
      relayOrigin: input.relayOrigin,
      ...input.identity,
      relayHostId: input.relayHostId,
      hostPublicKey: input.hostPublicKey,
      hostSecretKey: input.hostSecretKey,
      assignmentEpoch: input.assignmentEpoch,
      previousGeneration: input.previousGeneration,
      resumeRequested: input.resumeRequested,
      onInvalid: (reason: string) => {
        invalidReason = reason
      }
    } as never)
    return proofB64
      ? {
          kind: 'answer',
          frame: JSON.stringify({
            type: 'host-challenge-ack',
            challengeId: challenge.data.challengeId,
            proofB64
          })
        }
      : {
          kind: 'invalid',
          reason: `invalid host challenge: ${invalidReason} origin=${input.relayOrigin}`
        }
  }
  const ack = RelayHostHelloAckMessageSchema.safeParse(input.message)
  return ack.success
    ? { kind: 'accepted', ack: ack.data }
    : { kind: 'invalid', reason: 'invalid host proof message' }
}
