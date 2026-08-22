/**
 * The relay cell: three WebSocket endpoints that move end-to-end encrypted
 * bytes between a desktop host and its phones.
 *
 *   WSS /v1/host/control                  desktop control leg (authenticated)
 *   WSS /v1/host/data/{connId}            desktop data leg (ticket-authenticated)
 *   WSS /v1/connect/{relayHostId}         phone leg (credential-authenticated)
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { CONTROL_MAX_PAYLOAD_BYTES, DATA_MAX_PAYLOAD_BYTES } from '../shared/protocol.js'
import type { HostSession } from './session.js'
import { closeQuietly } from './session.js'
import { onHostControl, type HostControlContext } from './host-control.js'
import { onPhone, type PhoneLegContext } from './phone-leg.js'
import type { CellOptions } from './cell-options.js'
import type { ControlDeps } from './control-requests.js'
import { parseFrame, str, uint } from '../shared/wire.js'

export class RelayCell {
  private readonly sessions = new Map<string, HostSession>()
  /**
   * Set for the whole shutdown window.
   *
   * The upgrade itself is still accepted while draining: refusing it with an
   * HTTP 503 reaches a WebSocket client as a bare connection failure, and the
   * phone's recovery table is keyed on close codes. It has to be let in far
   * enough to be told 4503.
   */
  private draining = false
  /** connId -> session, so a data leg does not have to scan every session. */
  private readonly pendingIndex = new Map<string, HostSession>()
  private readonly hostControl = new WebSocketServer({
    noServer: true,
    maxPayload: CONTROL_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false
  })
  private readonly hostData = new WebSocketServer({
    noServer: true,
    maxPayload: DATA_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false
  })
  private readonly phone = new WebSocketServer({
    noServer: true,
    maxPayload: DATA_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false
  })
  private readonly controlDeps: ControlDeps

  private readonly controlContext: HostControlContext
  private readonly phoneContext: PhoneLegContext

  constructor(private readonly options: CellOptions) {
    this.controlDeps = {
      store: options.store,
      logger: options.logger,
      metrics: options.metrics,
      resumeTtlMs: options.resumeTtlMs,
      graceTtlMs: options.graceTtlMs,
      maxInviteAttempts: options.maxInviteAttempts,
      maxDevicesPerHost: options.maxDevicesPerHost,
      maxLiveInvitesPerHost: options.maxLiveInvitesPerHost,
      maxLedgerEntriesPerHost: options.maxLedgerEntriesPerHost
    }
    this.controlContext = {
      options,
      controlDeps: this.controlDeps,
      sessions: this.sessions,
      forgetPending: (session) => this.forgetPending(session),
      draining: () => this.draining
    }
    this.phoneContext = {
      options,
      sessions: this.sessions,
      draining: () => this.draining,
      rememberPending: (session, connId) => this.rememberPending(session, connId)
    }
  }

  /** Routes an HTTP upgrade to the matching leg; unknown paths are rejected. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, clientIp: string): boolean {
    // Everything here runs inside an 'upgrade' event, where a throw is an
    // uncaught exception and takes the process with it. `new URL` and
    // `decodeURIComponent` both throw on input a stranger fully controls, so a
    // request for `/v1/connect/%` would be a one-line remote kill.
    let path: string
    try {
      path = new URL(request.url ?? '/', this.options.origin).pathname
    } catch {
      return false
    }
    const segment = (prefix: string): string | null => {
      try {
        return decodeURIComponent(path.slice(prefix.length))
      } catch {
        return null
      }
    }
    if (path === '/v1/host/control') {
      this.hostControl.handleUpgrade(request, socket, head, (ws) =>
        onHostControl(ws, request, clientIp, this.controlContext)
      )
      return true
    }
    if (path.startsWith('/v1/host/data/')) {
      const connId = segment('/v1/host/data/')
      if (connId === null) {
        return false
      }
      this.hostData.handleUpgrade(request, socket, head, (ws) => this.onHostData(ws, connId))
      return true
    }
    if (path.startsWith('/v1/connect/')) {
      const relayHostId = segment('/v1/connect/')
      if (relayHostId === null) {
        return false
      }
      this.phone.handleUpgrade(request, socket, head, (ws) =>
        onPhone(ws, relayHostId, clientIp, this.phoneContext)
      )
      return true
    }
    return false
  }

  // ---------------------------------------------------------------- host control

  // ------------------------------------------------------------------ host data

  private onHostData(ws: WebSocket, connId: string): void {
    ws.on('error', () => closeQuietly(ws, 1011, 'socket error'))
    let settled = false
    const finish = (): void => {
      settled = true
      clearTimeout(guard)
    }
    const guard = setTimeout(() => {
      if (!settled) {
        closeQuietly(ws, 1008, 'data leg never authenticated')
      }
    }, this.options.attachDeadlineMs)
    guard.unref?.()

    ws.once('message', (raw, isBinary) => {
      if (isBinary) {
        finish()
        closeQuietly(ws, 1003, 'binary auth frame')
        return
      }
      const message = parseFrame(raw.toString('utf8'))
      if (!message) {
        finish()
        closeQuietly(ws, 1007, 'malformed data auth')
        return
      }
      if (message.type !== 'host-data-auth') {
        finish()
        closeQuietly(ws, 1008, 'unexpected data frame')
        return
      }
      const generation = uint(message.generation)
      const ticket = str(message.connTicket, 128)
      if (generation === null || ticket === null) {
        finish()
        closeQuietly(ws, 1008, 'invalid data auth')
        return
      }
      const session = this.pendingIndex.get(connId)
      if (!session || !session.attach(connId, ticket, generation, ws)) {
        finish()
        // Only forget the mapping once the connection itself is gone. A stale
        // leg presenting a wrong ticket must not evict the entry the desktop's
        // real data leg is about to look up.
        if (!session?.pending.has(connId)) {
          this.pendingIndex.delete(connId)
        }
        this.options.metrics.counter('manta_relay_data_leg_rejections_total', 'Data legs refused.')
        closeQuietly(ws, 1008, 'unknown or stale conn')
        return
      }
      this.pendingIndex.delete(connId)
      finish()
    })
    ws.on('close', finish)
    ws.on('error', finish)
  }

  // --------------------------------------------------------------------- phone

  private rememberPending(session: HostSession, connId: string): void {
    this.pendingIndex.set(connId, session)
    // The session drops its own pending entry on timeout or phone close; the
    // index has to be swept alongside it or it becomes the leak instead.
    setTimeout(() => {
      if (!session.pending.has(connId)) {
        this.pendingIndex.delete(connId)
      }
    }, this.options.attachDeadlineMs + 2_000).unref?.()
  }

  private forgetPending(session: HostSession): void {
    for (const connId of session.pending.keys()) {
      this.pendingIndex.delete(connId)
    }
  }

  sessionCount(): number {
    return this.sessions.size
  }

  /**
   * Whether a host is reachable right now.
   *
   * A session whose control socket is not OPEN is in its rebind grace window,
   * which is not the same as online: the machine list would otherwise show a
   * laptop as reachable for three seconds after it closed its lid.
   */
  isHostOnline(relayHostId: string): boolean {
    const session = this.sessions.get(relayHostId)
    return session !== undefined && session.control.readyState === session.control.OPEN
  }

  activeConnCount(): number {
    let total = 0
    for (const session of this.sessions.values()) {
      total += session.active.size
    }
    return total
  }

  drainAll(graceMs: number): void {
    this.draining = true
    for (const session of this.sessions.values()) {
      session.drain(graceMs)
    }
  }

  /**
   * Cuts every socket this cell owns, including ones that never got as far as a
   * session — an unauthenticated half-open leg still keeps the server from
   * closing, and it has no peer worth waiting for.
   */
  terminateAll(): void {
    for (const wss of [this.hostControl, this.hostData, this.phone]) {
      for (const client of wss.clients) {
        try {
          client.terminate()
        } catch {
          // Already gone.
        }
      }
    }
  }

  destroyAll(code: number, reason: string): void {
    for (const session of this.sessions.values()) {
      session.destroy(code, reason)
      closeQuietly(session.control, code, reason)
    }
    this.sessions.clear()
    this.pendingIndex.clear()
  }
}
