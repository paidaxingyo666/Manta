/**
 * One desktop host's live session on this cell: the control leg, the pending
 * connection handshakes, and the phone↔desktop byte pipes.
 */
import type { WebSocket } from 'ws'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { CLOSE_CODES, mintToken } from '../shared/protocol.js'
import { Pipe } from './pipe.js'

export type PendingConn = {
  connId: string
  connTicket: string
  kind: 'invite' | 'resume'
  relayDeviceId: string
  /** Which credential generation let this phone in; resume-confirm reports it. */
  acceptedAs?: 'current' | 'grace'
  phone: WebSocket
  /**
   * Frames the phone sent before the desktop attached.
   *
   * The phone starts its E2EE handshake in the same microtask it receives
   * relay-hello, while the desktop still has to open a whole new socket. Without
   * this buffer that first frame is dropped and the handshake deadlocks forever.
   */
  buffered: { data: Buffer; isBinary: boolean }[]
  bufferedBytes: number
  attached: boolean
  /** Cleared once the desktop data leg attaches. */
  timer: NodeJS.Timeout
}

export type ActiveConn = {
  connId: string
  relayDeviceId: string
  kind: 'invite' | 'resume'
  acceptedAs?: 'current' | 'grace'
  phone: WebSocket
  host: WebSocket
  /** Torn down with the pair so no interval outlives the sockets. */
  stop: () => void
}

export type SessionHooks = {
  onBytes?: (direction: 'phone-to-host' | 'host-to-phone', bytes: number) => void
  onEvent?: (event: string, fields?: Record<string, unknown>) => void
}

/** How many past connection ids a session remembers, for install validation. */
const RECENT_CONN_MEMORY = 64

/** Bounds the pre-attach buffer so a peer cannot exhaust memory before pairing. */
const MAX_BUFFERED_FRAMES = 64
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024
export class HostSession {
  readonly pending = new Map<string, PendingConn>()
  readonly active = new Map<string, ActiveConn>()
  private readonly phonePipes = new Map<string, Pipe>()
  /**
   * Connection ids that have existed on this session, newest last.
   *
   * A credential install naming a basis connection can legitimately arrive just
   * after that connection closed, so "unknown" has to mean "never existed here"
   * rather than "not open right now".
   */
  private readonly recentConnIds: string[] = []
  /** Bumped on every successful control handshake; data legs must match it. */
  generation = 0
  draining = false
  private drainTimer: NodeJS.Timeout | null = null
  private teardownTimer: NodeJS.Timeout | null = null

  constructor(
    readonly relayHostId: string,
    public control: WebSocket,
    public identityKey: string,
    private readonly hooks: SessionHooks = {}
  ) {}

  /**
   * Defers teardown so a lease rebind can reclaim this session.
   *
   * The replacement control leg arrives on a new socket while the old one is
   * closing; tearing down on that close would kick every phone and then leave
   * the rebind nothing to resume.
   */
  scheduleTeardown(delayMs: number, run: () => void): void {
    this.cancelTeardown()
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null
      run()
    }, delayMs)
    this.teardownTimer.unref?.()
  }

  cancelTeardown(): void {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer)
      this.teardownTimer = null
    }
  }

  /** True if this connection id was ever opened on this session. */
  knowsConn(connId: string): boolean {
    return (
      this.active.has(connId) || this.pending.has(connId) || this.recentConnIds.includes(connId)
    )
  }

  send(message: unknown): void {
    if (this.control.readyState === this.control.OPEN) {
      this.control.send(JSON.stringify(message))
    }
  }

  /**
   * Announces an inbound phone and waits for the desktop to attach a data leg.
   * The client terminates if nothing arrives within attachDeadlineMs, so the
   * timer here must fire slightly later to avoid a half-open pair.
   */
  openConn(
    phone: WebSocket,
    kind: 'invite' | 'resume',
    relayDeviceId: string,
    attachDeadlineMs: number,
    acceptedAs?: 'current' | 'grace'
  ): PendingConn {
    const connId = randomUUID()
    const connTicket = mintToken()
    const timer = setTimeout(() => {
      const stale = this.pending.get(connId)
      if (stale) {
        this.pending.delete(connId)
        this.hooks.onEvent?.('conn.attach_timeout', { connId, relayDeviceId })
        closeQuietly(stale.phone, CLOSE_CODES.HOST_OFFLINE, 'attach timeout')
      }
    }, attachDeadlineMs + 1_000)
    timer.unref?.()
    const conn: PendingConn = {
      connId,
      connTicket,
      kind,
      relayDeviceId,
      acceptedAs,
      phone,
      buffered: [],
      bufferedBytes: 0,
      attached: false,
      timer
    }
    this.pending.set(connId, conn)
    this.recentConnIds.push(connId)
    if (this.recentConnIds.length > RECENT_CONN_MEMORY) {
      this.recentConnIds.shift()
    }
    // Why register before announcing: this is the phone socket's only 'message'
    // listener for its whole lifetime. It buffers until the desktop attaches and
    // forwards directly afterwards, so no frame is ever dropped and none is
    // delivered twice.
    phone.on('message', (data, isBinary) => {
      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      // `attached` rather than a lookup in `active`: once the pair has been torn
      // down the connection is in neither map, and falling back to buffering
      // would quietly accumulate frames for a pair that no longer exists.
      if (conn.attached) {
        const pipe = this.phonePipes.get(connId)
        if (!pipe) {
          // Dropping a frame is the one thing the E2EE layer cannot survive, so
          // if this invariant ever breaks, end the connection loudly instead of
          // deadlocking the handshake forever.
          this.hooks.onEvent?.('conn.pipe_missing', { connId, relayDeviceId })
          closeQuietly(phone, CLOSE_CODES.PEER_DROPPED, 'pair is gone')
          return
        }
        pipe.push(frame, isBinary)
        return
      }
      if (
        conn.buffered.length >= MAX_BUFFERED_FRAMES ||
        conn.bufferedBytes + frame.byteLength > MAX_BUFFERED_BYTES
      ) {
        // E2EE cannot tolerate a gap, so an over-limit peer is closed rather
        // than silently truncated.
        this.hooks.onEvent?.('conn.prebuffer_overflow', { connId, relayDeviceId })
        // 4408, not 1009: the phone's recovery table is keyed on the 4xxx
        // codes, and 1009 lands in it as an unclassified transport failure.
        closeQuietly(phone, CLOSE_CODES.PEER_DROPPED, 'pre-attach buffer exceeded')
        return
      }
      conn.buffered.push({ data: frame, isBinary })
      conn.bufferedBytes += frame.byteLength
    })
    // A phone that hangs up before the desktop attaches should not leave a
    // pending slot occupied until the deadline.
    phone.on('close', () => {
      const stale = this.pending.get(connId)
      if (stale) {
        clearTimeout(stale.timer)
        this.pending.delete(connId)
      }
    })
    this.send({
      type: 'conn-open',
      connId,
      connTicket,
      kind,
      relayDeviceId,
      attachDeadlineMs
    })
    return conn
  }

  /**
   * Attaches the desktop data leg to a waiting phone and starts piping.
   *
   * Ordering and framing are load-bearing: the E2EE layer requires an exact
   * counter match with no reorder buffer, so every frame must be forwarded once,
   * in order, preserving its text/binary flag.
   */
  attach(connId: string, connTicket: string, generation: number, host: WebSocket): boolean {
    const conn = this.pending.get(connId)
    if (!conn || !secretsMatch(conn.connTicket, connTicket) || generation !== this.generation) {
      return false
    }
    const { phone } = conn
    if (phone.readyState !== phone.OPEN || host.readyState !== host.OPEN) {
      clearTimeout(conn.timer)
      this.pending.delete(connId)
      closeQuietly(phone, CLOSE_CODES.PEER_DROPPED, 'peer gone before attach')
      return false
    }
    clearTimeout(conn.timer)
    this.pending.delete(connId)
    conn.attached = true

    const teardown = (): void => {
      const record = this.active.get(connId)
      if (!record) {
        return
      }
      this.active.delete(connId)
      record.stop()
      this.phonePipes.delete(connId)
      closeQuietly(phone, CLOSE_CODES.PEER_DROPPED, 'peer dropped')
      closeQuietly(host, CLOSE_CODES.PEER_DROPPED, 'peer dropped')
    }

    const phoneToHost = new Pipe(phone, host, teardown, (bytes) =>
      this.hooks.onBytes?.('phone-to-host', bytes)
    )
    const hostToPhone = new Pipe(host, phone, teardown, (bytes) =>
      this.hooks.onBytes?.('host-to-phone', bytes)
    )
    this.phonePipes.set(connId, phoneToHost)

    // Keep the pair warm: reverse proxies commonly close idle WebSockets after
    // 60s, and a relayed session can legitimately sit quiet much longer.
    const keepAlive = setInterval(() => {
      for (const socket of [phone, host]) {
        if (socket.readyState === socket.OPEN) {
          socket.ping()
        }
      }
    }, 30_000)
    keepAlive.unref?.()

    this.active.set(connId, {
      connId,
      relayDeviceId: conn.relayDeviceId,
      kind: conn.kind,
      acceptedAs: conn.acceptedAs,
      phone,
      host,
      stop: () => {
        clearInterval(keepAlive)
        phoneToHost.stop()
        hostToPhone.stop()
      }
    })

    // Replay what arrived before the desktop was ready, in order and with the
    // original text/binary flag — the E2EE counter admits no gap or reorder.
    for (const frame of conn.buffered) {
      phoneToHost.push(frame.data, frame.isBinary)
    }
    conn.buffered.length = 0
    conn.bufferedBytes = 0

    // The phone side is already wired by openConn; only host→phone is new here.
    host.on('message', (data, isBinary) => {
      hostToPhone.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer), isBinary)
    })

    phone.on('close', teardown)
    host.on('close', teardown)
    phone.on('error', teardown)
    host.on('error', teardown)
    this.hooks.onEvent?.('conn.attached', { connId, relayDeviceId: conn.relayDeviceId })
    return true
  }

  /**
   * Tells the desktop to re-resolve, then hands connected phones the same news.
   *
   * The phones must be told explicitly: a bare socket close reaches them as
   * 1006, which their close-code table treats as a generic transport failure
   * rather than "this cell is going away, ask the director again".
   */
  drain(graceMs: number): void {
    if (this.draining) {
      return
    }
    this.draining = true
    this.send({ type: 'drain', graceMs, recovery: 'resolve-director' })
    this.drainTimer = setTimeout(
      () => {
        for (const conn of this.pending.values()) {
          clearTimeout(conn.timer)
          closeQuietly(conn.phone, CLOSE_CODES.DRAINING, 'cell draining')
        }
        this.pending.clear()
        for (const conn of this.active.values()) {
          conn.stop()
          closeQuietly(conn.phone, CLOSE_CODES.DRAINING, 'cell draining')
          closeQuietly(conn.host, 1001, 'cell draining')
        }
        this.active.clear()
        this.phonePipes.clear()
      },
      Math.max(0, graceMs)
    )
    this.drainTimer.unref?.()
  }

  destroy(code: number, reason: string): void {
    this.cancelTeardown()
    if (this.drainTimer) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }
    for (const conn of this.pending.values()) {
      clearTimeout(conn.timer)
      closeQuietly(conn.phone, code, reason)
    }
    this.pending.clear()
    for (const conn of this.active.values()) {
      conn.stop()
      closeQuietly(conn.phone, code, reason)
      closeQuietly(conn.host, code, reason)
    }
    this.active.clear()
    this.phonePipes.clear()
  }
}

/** Constant-time compare for values an attacker can guess byte by byte. */
function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

export function closeQuietly(socket: WebSocket, code: number, reason: string): void {
  try {
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
      socket.close(code, reason.slice(0, 120))
    }
  } catch {
    // A socket that is already gone needs no further handling.
  }
}
