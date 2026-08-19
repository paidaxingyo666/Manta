/**
 * The desktop's control leg: authentication, the host proof, and the request
 * loop that runs on top of it.
 *
 * Split out of the cell because this is the whole authentication story in one
 * place — token, proof, lease rebind — while the cell itself is routing plus
 * two much simpler legs. It takes the cell's shared state as an explicit
 * context rather than reaching into it.
 */
import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import {
  CLOSE_CODES,
  CONTROL_PING_INTERVAL_MS,
  CONTROL_SILENCE_TIMEOUT_MS,
  RELAY_HOST_ID_PATTERN,
  deriveRelayHostId
} from '../shared/protocol.js'
import { createHostChallenge, type PendingHostChallenge } from '../shared/host-proof.js'
import type { RelayTokenClaims } from '../shared/relay-token.js'
import type { HostSession } from './session.js'
import { closeQuietly } from './session.js'
import { handleControlRequest, type ControlDeps } from './control-requests.js'
import { parseFrame, str, uint } from '../shared/wire.js'
import type { CellOptions } from './cell-options.js'
import { CONTROL_REBIND_GRACE_MS, onHostChallengeAck } from './host-handshake.js'

/** What the control leg needs from the cell that owns it. */
export type HostControlContext = {
  options: CellOptions
  controlDeps: ControlDeps
  sessions: Map<string, HostSession>
  forgetPending: (session: HostSession) => void
  draining: () => boolean
}

export type ControlState = {
  session?: HostSession
  challenge?: PendingHostChallenge
  claims?: RelayTokenClaims
  relayHostId?: string
  previousGeneration?: number
  resumeSecret?: string
  /** Set once the handshake completes; before that no heartbeat is sent. */
  handshakeComplete?: boolean
  /** A second hello on one socket would orphan the first session. */
  helloSeen?: boolean
  clientIp: string
  alive: boolean
}

export function onHostControl(
  ws: WebSocket,
  request: IncomingMessage,
  clientIp: string,
  ctx: HostControlContext
): void {
  const { logger, metrics } = ctx.options
  // Before anything that can return early: a socket with no 'error' listener
  // turns a transport error into an uncaughtException, and the two rejection
  // paths below both return before the end of this function.
  ws.on('error', () => closeQuietly(ws, 1011, 'socket error'))
  const state: ControlState = { alive: true, clientIp }
  const auth = request.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  const claims = token ? ctx.options.verifyRelayToken(token) : null
  if (!claims) {
    logger.warn('host.control.rejected', { clientIp, reason: 'invalid_relay_token' })
    metrics.counter('manta_relay_host_rejections_total', 'Host control legs refused.', {
      reason: 'invalid_relay_token'
    })
    closeQuietly(ws, CLOSE_CODES.BAD_OUTER_CREDENTIAL, 'invalid relay token')
    return
  }
  if (ctx.draining()) {
    closeQuietly(ws, CLOSE_CODES.DRAINING, 'cell draining')
    return
  }
  state.claims = claims

  // Ping every 15s, but only give up after the client's own 75s window — a
  // tighter timeout would kill healthy legs. Nothing is sent before the
  // handshake completes: a ping arriving mid-proof confuses the client.
  let silentFor = 0
  const heartbeat = setInterval(() => {
    if (!state.handshakeComplete) {
      return
    }
    if (state.alive) {
      state.alive = false
      silentFor = 0
    } else {
      silentFor += CONTROL_PING_INTERVAL_MS
      if (silentFor >= CONTROL_SILENCE_TIMEOUT_MS) {
        logger.info('host.control.heartbeat_timeout', { relayHostId: state.relayHostId })
        closeQuietly(ws, 1001, 'heartbeat timeout')
        return
      }
    }
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', t: Date.now() }))
    }
  }, CONTROL_PING_INTERVAL_MS)
  heartbeat.unref?.()

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      closeQuietly(ws, 1003, 'binary frame on control leg')
      return
    }
    const message = parseFrame(raw.toString('utf8'))
    if (!message) {
      closeQuietly(ws, 1007, 'malformed control frame')
      return
    }
    state.alive = true
    try {
      onControlMessage(ws, state, message, ctx)
    } catch (error) {
      // Last resort. Anything thrown here would otherwise be an
      // uncaughtException, and one bad frame would take down every other
      // host's session along with this one.
      logger.error('control.handler_failed', { error, relayHostId: state.relayHostId })
      closeQuietly(ws, 1011, 'control handler failed')
    }
  })

  ws.on('close', () => {
    clearInterval(heartbeat)
    const { session } = state
    // Only tear down if this socket is still the session's control leg: after
    // a lease rebind the replaced socket closes, and it must not take the
    // live session with it.
    if (session && ctx.sessions.get(session.relayHostId) === session && session.control === ws) {
      // Not immediately, though. A rebind arrives on a *new* socket and the
      // old one often closes while the new one is still proving itself —
      // tearing down here would kick every phone and then leave the rebind
      // with no session to resume, so it would be refused too. The grace is
      // short enough that a departed host is still reported promptly, and no
      // new phone is admitted meanwhile because the control leg is shut.
      session.scheduleTeardown(CONTROL_REBIND_GRACE_MS, () => {
        if (ctx.sessions.get(session.relayHostId) !== session) {
          return
        }
        ctx.sessions.delete(session.relayHostId)
        ctx.forgetPending(session)
        session.destroy(CLOSE_CODES.HOST_OFFLINE, 'host disconnected')
        metrics.gauge('manta_relay_sessions', 'Live host sessions.', ctx.sessions.size)
        logger.info('host.control.closed', { relayHostId: session.relayHostId })
      })
    }
  })
}

function onControlMessage(
  ws: WebSocket,
  state: ControlState,
  message: Record<string, unknown>,
  ctx: HostControlContext
): void {
  const type = String(message.type ?? '')
  if (type === 'pong') {
    return
  }
  if (type === 'host-hello') {
    onHostHello(ws, state, message, ctx)
    return
  }
  if (type === 'host-challenge-ack') {
    onHostChallengeAck(ws, state, message, ctx)
    return
  }
  if (type === 'auth-refresh') {
    const refreshed = ctx.options.verifyRelayToken(str(message.relayJwt, 4 * 1024) ?? '')
    if (!refreshed) {
      // Staying silent here leaves the desktop believing it refreshed while
      // the cell still holds the token that is about to expire.
      ctx.options.logger.warn('host.auth_refresh_rejected', { relayHostId: state.relayHostId })
      state.session?.send({ type: 'control-error', code: 'invalid_relay_token' })
      return
    }
    if (state.relayHostId && refreshed.relayHostId && refreshed.relayHostId !== state.relayHostId) {
      ctx.options.logger.warn('host.auth_refresh_host_mismatch', { relayHostId: state.relayHostId })
      state.session?.send({ type: 'control-error', code: 'invalid_relay_token' })
      return
    }
    state.claims = refreshed
    return
  }
  if (!state.session) {
    closeQuietly(ws, 1008, 'not authenticated')
    return
  }
  // One desktop should issue a handful of control requests per pairing. A
  // flood is a client bug or a compromised host; either way it must not turn
  // into unbounded invite or ledger state.
  const decision = ctx.options.controlLimiter.take(`control:${state.session.relayHostId}`)
  if (!decision.ok) {
    ctx.options.metrics.counter(
      'manta_relay_rate_limited_total',
      'Requests refused by a rate limiter.',
      {
        surface: 'control'
      }
    )
    // Nothing beyond {type, reqId?, code}: the client's schema is strict, and
    // a helpful extra field like retryAfterMs makes it discard the whole
    // reply — which the desktop experiences as its request hanging.
    ctx.options.logger.warn('control.rate_limited', {
      relayHostId: state.session.relayHostId,
      retryAfterMs: decision.retryAfterMs
    })
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'control-error',
          reqId: typeof message.reqId === 'string' ? message.reqId : undefined,
          code: 'rate_limited'
        })
      )
    }
    return
  }
  // Replies go back on *this* socket rather than session.control. After a
  // rebind those differ, and the client deliberately keeps the old leg open
  // for ~10s so in-flight requests can finish — answering on the new one
  // strands the request and hands the new leg a reply it never asked for.
  const reply = (payload: unknown): void => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }
  if (!handleControlRequest(state.session, reply, message, type, ctx.controlDeps, Date.now())) {
    reply({
      type: 'control-error',
      reqId: typeof message.reqId === 'string' ? message.reqId : undefined,
      code: 'unsupported_request'
    })
  }
}

function onHostHello(
  ws: WebSocket,
  state: ControlState,
  message: Record<string, unknown>,
  ctx: HostControlContext
): void {
  const { logger, metrics } = ctx.options
  const reject = (code: number, reason: string, why: string): void => {
    logger.warn('host.hello.rejected', { clientIp: state.clientIp, reason: why })
    metrics.counter('manta_relay_host_rejections_total', 'Host control legs refused.', {
      reason: why
    })
    closeQuietly(ws, code, reason)
  }
  // A second hello on the same socket would leave the first session in the
  // map with no live control leg behind it.
  if (state.helloSeen) {
    reject(1008, 'duplicate host-hello', 'duplicate_hello')
    return
  }
  state.helloSeen = true
  const relayHostId = str(message.relayHostId, 64) ?? ''
  const hostPublicKeyB64 = str(message.hostPublicKeyB64, 128) ?? ''
  if (!RELAY_HOST_ID_PATTERN.test(relayHostId) || !state.claims) {
    reject(1008, 'invalid host-hello', 'invalid_hello')
    return
  }
  // Why bind the token to the host id: a valid token for user A must not be
  // usable to take over user B's host session.
  if (state.claims.relayHostId && state.claims.relayHostId !== relayHostId) {
    reject(CLOSE_CODES.BAD_OUTER_CREDENTIAL, 'relay token host mismatch', 'host_mismatch')
    return
  }
  const hostPublicKey = Buffer.from(hostPublicKeyB64, 'base64')
  if (hostPublicKey.byteLength !== 32) {
    reject(1008, 'invalid host public key', 'bad_public_key')
    return
  }
  // Why verify the derivation: relayHostId is defined as a digest of the host
  // key. Accepting an arbitrary pair would let anyone with a valid token claim
  // another user's host id and receive their phones' traffic.
  if (deriveRelayHostId(hostPublicKey) !== relayHostId) {
    reject(
      CLOSE_CODES.BAD_OUTER_CREDENTIAL,
      'relay host id is not derived from the key',
      'host_id_not_derived'
    )
    return
  }
  // uint() rather than Number(): a negative or fractional value reaches the
  // challenge transcript, where writeBigUInt64BE throws — before the proof
  // has verified anything, so any holder of a relay token could use it.
  const epoch = uint(message.assignmentEpoch)
  if (epoch === null || epoch !== ctx.options.assignmentEpoch) {
    reject(CLOSE_CODES.WRONG_CELL, 'assignment epoch mismatch', 'epoch_mismatch')
    return
  }
  // Refuse before allocating anything: a cell that is full should say so to
  // the newcomer rather than degrade for the hosts already on it.
  if (!ctx.sessions.has(relayHostId) && ctx.sessions.size >= ctx.options.maxSessions) {
    reject(CLOSE_CODES.LIMIT_EXCEEDED, 'cell at capacity', 'cell_full')
    return
  }
  let previousGeneration: number | undefined
  if (message.previousGeneration !== undefined) {
    const parsed = uint(message.previousGeneration)
    if (parsed === null) {
      reject(1008, 'invalid previousGeneration', 'bad_previous_generation')
      return
    }
    previousGeneration = parsed
  }
  state.previousGeneration = previousGeneration
  state.resumeSecret = str(message.controlResumeSecret, 128) ?? undefined
  const challenge = createHostChallenge({
    relayOrigin: ctx.options.origin,
    relayHostId,
    hostPublicKey,
    assignmentEpoch: epoch,
    previousGeneration,
    resumeRequested: typeof message.controlResumeSecret === 'string',
    identity: {
      userId: state.claims.userId,
      profileId: state.claims.profileId,
      organizationId: state.claims.organizationId
    }
  })
  state.challenge = challenge
  state.relayHostId = relayHostId
  ws.send(JSON.stringify({ type: 'host-challenge', ...challenge.message }))
}
