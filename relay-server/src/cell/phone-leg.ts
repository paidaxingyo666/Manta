/**
 * The phone leg: the only endpoint a stranger can reach with no credential at
 * all, and the one whose close codes carry the most expensive consequences.
 *
 * 4401 makes a phone permanently retire a credential version, so it is used
 * only when a well-formed credential genuinely matched nothing. Everything
 * else — a malformed frame, an offline host, a rate limit — gets a code the
 * phone can recover from.
 */
import type { WebSocket } from 'ws'
import { CLOSE_CODES, RELAY_HOST_ID_PATTERN, TOKEN_PATTERN } from '../shared/protocol.js'
import { closeQuietly, type HostSession } from './session.js'
import { parseFrame, str } from '../shared/wire.js'
import { rateLimitKey } from '../shared/client-ip.js'
import type { CellOptions } from './cell-options.js'

/** What the phone leg needs from the cell that owns it. */
export type PhoneLegContext = {
  options: CellOptions
  sessions: Map<string, HostSession>
  draining: () => boolean
  rememberPending: (session: HostSession, connId: string) => void
}

export function onPhone(
  ws: WebSocket,
  relayHostId: string,
  clientIp: string,
  ctx: PhoneLegContext
): void {
  const { logger, metrics } = ctx.options
  ws.on('error', () => closeQuietly(ws, 1011, 'socket error'))
  // The phone sends its auth frame immediately on open and never waits for us.
  const guard = setTimeout(() => closeQuietly(ws, 1008, 'no auth frame'), 5_000)
  guard.unref?.()
  ws.on('close', () => clearTimeout(guard))

  ws.once('message', (raw, isBinary) => {
    clearTimeout(guard)
    if (isBinary) {
      closeQuietly(ws, 1003, 'binary auth frame')
      return
    }
    const message = parseFrame(raw.toString('utf8'))
    if (!message) {
      closeQuietly(ws, 1007, 'malformed auth frame')
      return
    }
    if (message.type !== 'relay-auth' || message.mode !== 'connect') {
      closeQuietly(ws, 1008, 'unexpected auth frame')
      return
    }
    const credential = str(message.credential, 128) ?? ''
    // Why not 4401 here: a malformed request says nothing about the phone's
    // credential, and 4401 makes it retire that version permanently.
    if (!TOKEN_PATTERN.test(credential) || !RELAY_HOST_ID_PATTERN.test(relayHostId)) {
      rejectPhone(ws, CLOSE_CODES.HOST_OFFLINE)
      return
    }
    const tooFast = (decision: { ok: boolean; retryAfterMs: number }): boolean => {
      if (decision.ok) {
        return false
      }
      metrics.counter('manta_relay_rate_limited_total', 'Requests refused by a rate limiter.', {
        surface: 'phone'
      })
      logger.warn('phone.rate_limited', {
        clientIp,
        relayHostId,
        retryAfterMs: decision.retryAfterMs
      })
      rejectPhone(ws, CLOSE_CODES.LIMIT_EXCEEDED)
      return true
    }
    // Per source first: this is the only key a stranger can mint, and it is
    // bounded by how many addresses they hold.
    if (tooFast(ctx.options.phoneLimiter.take(`phone:${rateLimitKey(clientIp)}`))) {
      return
    }
    if (ctx.draining()) {
      rejectPhone(ws, CLOSE_CODES.DRAINING)
      return
    }
    const session = ctx.sessions.get(relayHostId)
    if (!session || session.control.readyState !== session.control.OPEN) {
      rejectPhone(ws, CLOSE_CODES.HOST_OFFLINE)
      return
    }
    // Per host id only *after* the host is known to be online, and in its own
    // table. Charging it earlier would let anyone fill the limiter with keys
    // for host ids that do not exist, and a full table refuses new keys —
    // which is how a rate limiter becomes the denial of service.
    if (tooFast(ctx.options.hostConnectLimiter.take(`host:${relayHostId}`))) {
      return
    }
    if (session.draining) {
      rejectPhone(ws, CLOSE_CODES.DRAINING)
      return
    }
    // Two reasons for this ceiling. Every pending connection holds a socket
    // and a replay buffer open until the desktop attaches. And the client's
    // host-hello-ack schema caps activeConnIds and pendingConns at 8 each —
    // a ninth would make the *entire* ack fail to parse, turning the next
    // lease rebind into a full reconnect for every phone on this host.
    if (session.pending.size + session.active.size >= ctx.options.maxConnsPerHost) {
      metrics.counter('manta_relay_rate_limited_total', 'Requests refused by a rate limiter.', {
        surface: 'pending'
      })
      rejectPhone(ws, CLOSE_CODES.LIMIT_EXCEEDED)
      return
    }
    const now = Date.now()
    const { store } = ctx.options
    const leaseExpiresAt = now + ctx.options.attachDeadlineMs

    const invite = store.takeInvite(relayHostId, credential, now)
    if (invite) {
      // One-shot: a scanned QR must not be replayable by a second device.
      store.consumeInvite(relayHostId, credential)
      ws.send(
        JSON.stringify({ type: 'relay-hello', ok: true, credentialKind: 'invite', leaseExpiresAt })
      )
      const conn = session.openConn(
        ws,
        'invite',
        invite.relayDeviceId,
        ctx.options.attachDeadlineMs
      )
      ctx.rememberPending(session, conn.connId)
      metrics.counter('manta_relay_phone_connects_total', 'Phone connections admitted.', {
        kind: 'invite'
      })
      logger.info('phone.connected', {
        relayHostId,
        relayDeviceId: invite.relayDeviceId,
        kind: 'invite'
      })
      return
    }

    const resume = store.matchResume(relayHostId, credential, now)
    if (resume) {
      ws.send(
        JSON.stringify({
          type: 'relay-hello',
          ok: true,
          credentialKind: 'resume',
          leaseExpiresAt,
          // The phone compares this against its local version and fails hard
          // on a mismatch, so it must reflect the generation we accepted.
          acceptedCredentialVersion: resume.generation.version,
          acceptedAs: resume.acceptedAs,
          resumeExpiresAt: resume.generation.expiresAt,
          ...(resume.device.grace ? { graceExpiresAt: resume.device.grace.expiresAt } : {})
        })
      )
      const conn = session.openConn(
        ws,
        'resume',
        resume.device.relayDeviceId,
        ctx.options.attachDeadlineMs,
        resume.acceptedAs
      )
      ctx.rememberPending(session, conn.connId)
      metrics.counter('manta_relay_phone_connects_total', 'Phone connections admitted.', {
        kind: 'resume'
      })
      logger.info('phone.connected', {
        relayHostId,
        relayDeviceId: resume.device.relayDeviceId,
        kind: 'resume',
        acceptedAs: resume.acceptedAs
      })
      return
    }

    metrics.counter('manta_relay_phone_rejections_total', 'Phone connections refused.', {
      reason: 'bad_credential'
    })
    logger.warn('phone.rejected', { relayHostId, clientIp, reason: 'bad_credential' })
    // Give the token back. The per-host bucket is shared by every phone this
    // desktop owns, and it is keyed on the host id alone — so charging it for
    // an attempt that presented a worthless credential lets anyone who knows
    // the id hold that bucket at zero and lock the owner's real phones out
    // indefinitely. Only credentials that actually matched should count
    // against the owner; strangers are bounded by the per-source bucket,
    // which was charged before this and is not refunded.
    ctx.options.hostConnectLimiter.refund(`host:${relayHostId}`)
    rejectPhone(ws, CLOSE_CODES.BAD_OUTER_CREDENTIAL)
  })
}

/**
 * A rejection is reported both in the relay-hello body and the close code —
 * 4401 makes the phone permanently retire that credential version, so it must
 * only be used for genuinely bad credentials.
 */
function rejectPhone(ws: WebSocket, code: number): void {
  if (ws.readyState === ws.OPEN) {
    // Exactly {type, ok, code}. The phone's schema for a refusal is strict,
    // and an extra field — even a helpful retryAfterMs — makes it fall through
    // to a generic 'invalid relay hello' instead of the recovery the code
    // was chosen to trigger. The backoff is the phone's to compute.
    ws.send(JSON.stringify({ type: 'relay-hello', ok: false, code }))
  }
  closeQuietly(ws, code, 'rejected')
}
