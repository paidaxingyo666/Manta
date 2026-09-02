/**
 * The second half of the host handshake: verifying the proof and establishing
 * or resuming the session.
 *
 * Separated from the control leg's transport concerns because this is where
 * the security decisions live — whether a proof is genuine, whether a lease
 * rebind may reclaim an existing session, and which close code a refusal earns.
 * 4401 here makes the client discard its resume secret, so it is reserved for
 * a genuine credential mismatch.
 */
import { timingSafeEqual } from 'node:crypto'
import type { WebSocket } from 'ws'
import { CLOSE_CODES, hashCredential, mintToken } from '../shared/protocol.js'
import { verifyHostProof } from '../shared/host-proof.js'
import { HostSession, closeQuietly } from './session.js'
import { str } from '../shared/wire.js'
import type { HostControlContext, ControlState } from './host-control.js'

function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

/**
 * How long a session outlives its control socket.
 *
 * Long enough for a replacement leg to finish its proof, short enough that a
 * host that really went away is reported offline promptly.
 */
export const CONTROL_REBIND_GRACE_MS = 3_000

export function onHostChallengeAck(
  ws: WebSocket,
  state: ControlState,
  message: Record<string, unknown>,
  ctx: HostControlContext
): void {
  const { logger, metrics } = ctx.options
  const { challenge, relayHostId, claims } = state
  if (!challenge || !relayHostId || !claims) {
    closeQuietly(ws, 1008, 'unexpected challenge ack')
    return
  }
  if (
    str(message.challengeId, 128) !== challenge.message.challengeId ||
    Date.now() > challenge.expiresAt
  ) {
    logger.warn('host.proof.stale', { relayHostId, clientIp: state.clientIp })
    metrics.counter('manta_relay_host_rejections_total', 'Host control legs refused.', {
      reason: 'stale_challenge'
    })
    closeQuietly(ws, 1008, 'stale challenge')
    return
  }
  if (!verifyHostProof(challenge, str(message.proofB64, 8 * 1024) ?? '')) {
    // This is the failure an operator will actually have to debug — a mismatch
    // usually means the public origin does not match what the desktop dialled,
    // or the configured identity triple differs from the desktop's profile.
    logger.warn('host.proof.rejected', {
      relayHostId,
      clientIp: state.clientIp,
      origin: ctx.options.origin,
      assignmentEpoch: ctx.options.assignmentEpoch,
      userId: claims.userId,
      profileId: claims.profileId,
      hasOrganization: claims.organizationId !== ''
    })
    metrics.counter('manta_relay_host_rejections_total', 'Host control legs refused.', {
      reason: 'bad_proof'
    })
    closeQuietly(ws, CLOSE_CODES.BAD_OUTER_CREDENTIAL, 'host proof rejected')
    return
  }
  state.challenge = undefined

  const { store } = ctx.options
  const hostRecord = store.host(relayHostId)
  const previous = ctx.sessions.get(relayHostId)
  const offeredSecret = state.resumeSecret
  const previousGeneration = state.previousGeneration

  // A lease rebind arrives on a *new* socket carrying previousGeneration plus
  // the resume secret. It must reuse the very same session: the client asserts
  // the generation is unchanged and that its in-flight connections come back.
  // Replacing the session here would kick every phone every ~9 minutes.
  const resuming =
    previous !== undefined &&
    offeredSecret !== undefined &&
    hostRecord.controlResumeSecretHash !== undefined &&
    previousGeneration === previous.generation &&
    secretsMatch(hostRecord.controlResumeSecretHash, hashCredential(offeredSecret))

  if (offeredSecret !== undefined && !resuming) {
    // Say so explicitly: the client has a dedicated fallback that opens a
    // fresh origin with previousGeneration undefined after a 4401 here.
    logger.info('host.resume.rejected', { relayHostId, hadSession: previous !== undefined })
    metrics.counter('manta_relay_host_rejections_total', 'Host control legs refused.', {
      reason: 'resume_rejected'
    })
    closeQuietly(ws, CLOSE_CODES.BAD_OUTER_CREDENTIAL, 'control resume rejected')
    return
  }

  let session: HostSession
  if (resuming && previous) {
    // The old control leg is left to the client to retire once its in-flight
    // requests drain; closing it here would race the rebind and publish a
    // spurious offline.
    previous.cancelTeardown()
    previous.control = ws
    session = previous
  } else {
    if (previous) {
      previous.cancelTeardown()
      ctx.forgetPending(previous)
      previous.destroy(CLOSE_CODES.PEER_DROPPED, 'host reconnected')
    }
    session = new HostSession(relayHostId, ws, claims.userId, {
      onBytes: (direction, bytes) =>
        metrics.counter(
          'manta_relay_forwarded_bytes_total',
          'Bytes relayed between peers.',
          {
            direction
          },
          bytes
        ),
      onEvent: (event, fields) => logger.debug(event, { relayHostId, ...fields })
    })
    session.generation = store.nextGeneration(relayHostId)
    ctx.sessions.set(relayHostId, session)
  }
  state.session = session
  store.markSeen(relayHostId, Date.now())

  const controlResumeSecret = mintToken()
  hostRecord.controlResumeSecretHash = hashCredential(controlResumeSecret)
  store.touch()
  ws.send(
    JSON.stringify({
      type: 'host-hello-ack',
      v: 1,
      generation: session.generation,
      controlResumeSecret,
      leaseExpiresAt: Date.now() + ctx.options.leaseTtlMs,
      activeConnIds: [...session.active.keys()],
      pendingConns: [...session.pending.values()].map((conn) => ({
        connId: conn.connId,
        connTicket: conn.connTicket
      }))
    })
  )
  state.handshakeComplete = true
  metrics.gauge('manta_relay_sessions', 'Live host sessions.', ctx.sessions.size)
  logger.info('host.online', { relayHostId, generation: session.generation, resumed: resuming })
  // Only after the new leg is acknowledged is it safe to drop a replaced one.
  if (!resuming && previous) {
    closeQuietly(previous.control, 1001, 'replaced by newer session')
  }
}
