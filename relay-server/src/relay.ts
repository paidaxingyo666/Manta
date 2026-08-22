/**
 * Composition root: auth + director + cell behind one HTTP server.
 *
 * Splitting them across hosts is possible (each is independent), but one
 * process is what a self-hosted deployment actually wants — and it keeps the
 * cell's assignment epoch and the director's answer trivially consistent.
 *
 * This is deliberately the *only* place the stack is assembled, so tests and
 * production exercise the same wiring, including the upgrade path and the rate
 * limiters that sit in front of it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import type { RelayConfig } from './config.js'
import { RelayAuthServer } from './auth/server.js'
import { AuthSessionStore } from './auth/store.js'
import { AccountStore } from './auth/accounts.js'
import { RelayDirector } from './director/server.js'
import { RelayCell } from './cell/server.js'
import { CellStore } from './cell/store.js'
import { createRelayTokenVerifier } from './shared/relay-token.js'
import { Logger } from './shared/log.js'
import { Metrics } from './metrics.js'
import { RateLimiter } from './shared/rate-limit.js'
import { clientAddress, parseTrustedProxies, rateLimitKey } from './shared/client-ip.js'
import { CLOSE_CODES } from './shared/protocol.js'
import { startCertificateWatch } from './shared/certificate-expiry.js'
import { buildInfo } from './build-info.js'

/** How long a lingering socket may delay shutdown before it is cut. */
const LINGER_MS = 1_000

export type Relay = {
  server: Server
  cell: RelayCell
  store: CellStore
  accounts: AccountStore
  authSessions: AuthSessionStore
  logger: Logger
  metrics: Metrics
  listen: () => Promise<number>
  /** Drains peers, waits out the grace window, then releases every resource. */
  shutdown: (reason: string) => Promise<void>
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  response.end(payload)
}

function bearerMatches(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

export function createRelay(config: RelayConfig, logger = new Logger(config.logLevel)): Relay {
  const metrics = new Metrics()
  const trustedProxies = parseTrustedProxies(config.trustedProxies)
  const verifyRelayToken = createRelayTokenVerifier(config.relayTokenSecret)

  // Accounts come first: both stores below adopt anything written before
  // accounts existed under the legacy account, so its id has to exist already.
  const accounts = new AccountStore(
    config.dataDir ? join(config.dataDir, 'auth-accounts.json') : null,
    (error) => logger.error('accounts.persist_failed', { error })
  )
  const legacyAccount = accounts.bootstrapLegacy(config.user, Date.now())

  const store = new CellStore(
    config.dataDir,
    (error) => logger.error('cell.persist_failed', { error }),
    legacyAccount.accountId
  )
  const authSessions = new AuthSessionStore(
    config.dataDir ? join(config.dataDir, 'auth-sessions.json') : null,
    (error) => logger.error('auth.persist_failed', { error }),
    legacyAccount.accountId
  )

  const httpLimiter = new RateLimiter({
    capacity: config.limits.httpBurst,
    refillPerSecond: config.limits.httpPerSecond
  })
  const authLimiter = new RateLimiter({
    capacity: config.limits.authBurst,
    refillPerSecond: config.limits.authPerSecond
  })
  const phoneLimiter = new RateLimiter({
    capacity: config.limits.phoneBurst,
    refillPerSecond: config.limits.phonePerSecond
  })
  // Its own table, keyed by host id. Bounded by maxSessions because the key is
  // only ever charged for a host that is actually online.
  const hostConnectLimiter = new RateLimiter({
    capacity: config.limits.phoneBurst,
    refillPerSecond: config.limits.phonePerSecond,
    maxKeys: Math.max(64, config.maxSessions * 4)
  })
  const controlLimiter = new RateLimiter({
    capacity: config.limits.controlBurst,
    refillPerSecond: config.limits.controlPerSecond
  })

  const auth = new RelayAuthServer({
    accounts,
    legacyAccountId: legacyAccount.accountId,
    hosts: store,
    // Bound late: the cell is constructed below, and the directory needs to ask
    // it who is online right now rather than trust a stored flag.
    isHostOnline: (relayHostId) => cell.isHostOnline(relayHostId),
    maxHostsPerAccount: config.maxHostsPerAccount,
    registrationMode: config.registrationMode,
    relayTokenSecret: config.relayTokenSecret,
    relayTokenTtlMs: config.relayTokenTtlMs,
    sessionTtlMs: config.sessionTtlMs,
    sessions: authSessions,
    logger,
    metrics,
    limiter: authLimiter,
    ...(config.expectedClientId ? { expectedClientId: config.expectedClientId } : {}),
    ...(config.enrollmentSecret ? { enrollmentSecret: config.enrollmentSecret } : {})
  })

  const director = new RelayDirector({
    cellUrl: config.publicUrl,
    assignmentEpoch: config.assignmentEpoch,
    leaseTtlMs: config.leaseTtlMs,
    verifyRelayToken,
    logger,
    metrics,
    limiter: httpLimiter
  })

  const cell = new RelayCell({
    origin: config.publicUrl,
    store,
    verifyRelayToken,
    assignmentEpoch: config.assignmentEpoch,
    resumeTtlMs: config.resumeTtlMs,
    graceTtlMs: config.graceTtlMs,
    leaseTtlMs: config.leaseTtlMs,
    attachDeadlineMs: config.attachDeadlineMs,
    maxInviteAttempts: config.maxInviteAttempts,
    maxDevicesPerHost: config.maxDevicesPerHost,
    maxLiveInvitesPerHost: config.maxLiveInvitesPerHost,
    maxLedgerEntriesPerHost: config.maxLedgerEntriesPerHost,
    maxSessions: config.maxSessions,
    maxConnsPerHost: config.maxConnsPerHost,
    logger,
    metrics,
    phoneLimiter,
    hostConnectLimiter,
    controlLimiter
  })

  let shuttingDown = false

  const server = createServer((request, response) => {
    void (async () => {
      const clientIp = clientAddress(request, trustedProxies)
      try {
        // Health is the one unauthenticated endpoint and it says only whether
        // the process is up. Session counts belong on /metrics, behind a token.
        if (request.url === '/health' || request.url === '/healthz') {
          // Version travels with the health check so an operator can confirm what
          // is running without shell access to the host.
          json(response, shuttingDown ? 503 : 200, { ok: !shuttingDown, ...buildInfo() })
          return
        }
        if (request.url === '/metrics') {
          if (!config.metricsToken || !bearerMatches(request, config.metricsToken)) {
            // 404 rather than 401 when unconfigured: an operator who never set a
            // token has not opted into exposing this at all.
            json(response, config.metricsToken ? 401 : 404, { error: 'not_found' })
            return
          }
          metrics.gauge('manta_relay_sessions', 'Live host sessions.', cell.sessionCount())
          metrics.gauge(
            'manta_relay_active_conns',
            'Live phone-desktop pairs.',
            cell.activeConnCount()
          )
          metrics.gauge(
            'manta_relay_known_hosts',
            'Host records held in the store.',
            store.hostCount
          )
          metrics.gauge('manta_relay_auth_sessions', 'Stored auth sessions.', authSessions.size)
          metrics.gauge('manta_relay_accounts', 'Registered accounts.', accounts.size)
          const body = metrics.render()
          response.writeHead(200, {
            'content-type': 'text/plain; version=0.0.4',
            'content-length': Buffer.byteLength(body),
            'cache-control': 'no-store'
          })
          response.end(body)
          return
        }
        if (await auth.handle(request, response, clientIp)) {
          return
        }
        if (await director.handle(request, response, clientIp)) {
          return
        }
        json(response, 404, { error: 'not_found' })
      } catch (error) {
        // Path only, never the query. The enrolment secret is submitted as a
        // query parameter, and the redactor matches on field *names* — `url`
        // is not one of them, so a full URL here writes the secret to disk.
        logger.error('request.failed', {
          error,
          path: (request.url ?? '').split('?')[0],
          clientIp
        })
        if (!response.headersSent) {
          json(response, 500, { error: 'internal_error' })
        } else {
          response.destroy()
        }
      }
    })()
  })

  // Slowloris defence: without these a peer can hold a socket open indefinitely
  // by dribbling out request headers, and each one costs a file descriptor.
  server.headersTimeout = 15_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 65_000

  /**
   * Refuses an upgrade at the HTTP layer.
   *
   * A raw socket with no 'error' listener turns a failed write into an uncaught
   * exception, and by the time we are refusing a request the peer may already
   * be gone — so the listener goes on before anything is written.
   */
  function refuseUpgrade(duplex: Duplex, status: string, extra = ''): void {
    duplex.on('error', () => {
      // The peer hung up first; there is nothing left to tell it.
    })
    try {
      duplex.write(`HTTP/1.1 ${status}\r\n${extra}Connection: close\r\n\r\n`)
    } catch {
      // Already gone.
    }
    duplex.destroy()
  }

  server.on('upgrade', (request, socket, head) => {
    const duplex = socket as Duplex
    try {
      const clientIp = clientAddress(request, trustedProxies)
      // No 503 short-circuit here even while draining: a WebSocket client sees
      // an HTTP refusal as a bare connection error, and the phone's recovery is
      // keyed on close codes. The cell lets it in far enough to answer 4503.
      //
      // Upgrades bypass the request handler entirely, so the HTTP limiter has
      // to be applied here too — otherwise the cheapest way to flood the relay
      // is the one path that never reaches it.
      if (!httpLimiter.take(`upgrade:${rateLimitKey(clientIp)}`).ok) {
        metrics.counter('manta_relay_rate_limited_total', 'Requests refused by a rate limiter.', {
          surface: 'upgrade'
        })
        refuseUpgrade(duplex, '429 Too Many Requests', 'Retry-After: 5\r\n')
        return
      }
      if (!cell.handleUpgrade(request, duplex, head, clientIp)) {
        refuseUpgrade(duplex, '404 Not Found')
      }
    } catch (error) {
      // An 'upgrade' handler runs outside every other guard in this file: a
      // throw here is an uncaught exception and ends the process.
      logger.error('upgrade.failed', { error, url: request.url })
      refuseUpgrade(duplex, '400 Bad Request')
    }
  })

  const stopCertificateWatch = startCertificateWatch(config.tlsCertPath, metrics, logger)

  const sweeper = setInterval(() => {
    const now = Date.now()
    store.sweep(now)
    authSessions.prune(now)
    for (const limiter of [
      httpLimiter,
      authLimiter,
      phoneLimiter,
      hostConnectLimiter,
      controlLimiter
    ]) {
      limiter.sweep(now)
    }
  }, 60_000)
  sweeper.unref?.()

  return {
    server,
    cell,
    store,
    accounts,
    authSessions,
    logger,
    metrics,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, () => {
          server.off('error', reject)
          resolve((server.address() as { port: number }).port)
        })
      }),
    shutdown: async (reason: string) => {
      if (shuttingDown) {
        return
      }
      shuttingDown = true
      clearInterval(sweeper)
      stopCertificateWatch()
      const graceMs = config.shutdownGraceMs
      logger.info('relay.draining', { reason, graceMs })
      // Commit state before anything that can be made to hang. A rotation the
      // cell has already acknowledged to a phone must be on disk even if the
      // rest of this sequence is cut short by SIGKILL — otherwise the phone
      // holds a credential the relay has never heard of.
      store.flush()
      authSessions.flush()
      accounts.flush()
      // Tell peers, then give them the grace window to migrate. Phones need an
      // explicit 4503; a bare socket close reaches them as 1006, which their
      // close-code table treats as a generic transport failure.
      cell.drainAll(graceMs)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, graceMs)
        timer.unref?.()
      })
      cell.destroyAll(CLOSE_CODES.DRAINING, 'relay shutting down')
      // server.close() resolves only once every upgraded socket has ended, and
      // a peer that completes the handshake then stops reading holds it for
      // ws's 30s close timeout. That is longer than any supervisor's stop
      // grace, so the wait is bounded and then the sockets are cut.
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      const settled = await Promise.race([
        closed.then(() => true),
        new Promise<false>((resolve) => {
          const timer = setTimeout(() => resolve(false), LINGER_MS)
          timer.unref?.()
        })
      ])
      if (!settled) {
        logger.warn('relay.forcing_connections_closed')
        cell.terminateAll()
        server.closeAllConnections?.()
        await closed
      }
      store.flush()
      authSessions.flush()
      accounts.flush()
      logger.info('relay.stopped', { reason })
    }
  }
}
