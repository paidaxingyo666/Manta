/**
 * Minimal Manta Cloud auth surface.
 *
 * The desktop needs this only to obtain an identity and a relay token. Tokens
 * are opaque to the client, so this implements the smallest thing that
 * satisfies the contract: a loopback OAuth redirect that grants a session for a
 * configured single user, plus the relay-token issuer.
 *
 * `capabilities.flags["relay.use"]` must be true or the desktop gates the whole
 * relay path before ever contacting the director.
 *
 * Every endpoint except /authorize is POST — that is what the client sends, and
 * accepting GET would make the state-changing ones reachable from a plain link.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RELAY_HOST_ID_PATTERN } from '../shared/protocol.js'
import { rateLimitKey } from '../shared/client-ip.js'
import { issueRelayToken } from '../shared/relay-token.js'
import type { AuthSessionStore, AuthSession } from './store.js'
import type { Logger } from '../shared/log.js'
import type { Metrics } from '../metrics.js'
import type { RateLimiter } from '../shared/rate-limit.js'
import { identityBody, sessionBody } from './identity.js'

export type AuthUser = {
  userId: string
  profileId: string
  organizationId: string
  email: string
  displayName: string
}

export type AuthOptions = {
  user: AuthUser
  relayTokenSecret: string
  relayTokenTtlMs: number
  sessionTtlMs: number
  sessions: AuthSessionStore
  logger: Logger
  metrics: Metrics
  limiter: RateLimiter
  /** Rejects an authorize request from an unexpected desktop build. */
  expectedClientId?: string
  /**
   * Shared secret the desktop sends when redeeming an authorization code.
   *
   * Without it, anyone who can reach this port gets a session and a relay
   * token. That does not hand over a host — the host proof needs the desktop's
   * secret key — but it does leak the configured identity, let a stranger
   * occupy the session table until the real desktop is evicted, and open a
   * control leg, which is the doorway to every other authenticated surface.
   */
  enrollmentSecret?: string
}

const MAX_BODY_BYTES = 16 * 1024
const CODE_TTL_MS = 5 * 60_000
/** An unredeemed code is a pending grant; a few is normal, thousands is abuse. */
const MAX_PENDING_CODES = 32

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>
): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  })
  response.end(payload)
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += (chunk as Buffer).byteLength
      if (size > MAX_BODY_BYTES) {
        // Stop reading rather than keep buffering. Destroying the request makes
        // the async iterator reject, which is why this whole loop is guarded:
        // an oversize body is a bad request, not a 500.
        request.destroy()
        return null
      }
      chunks.push(chunk as Buffer)
    }
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

export class RelayAuthServer {
  /** Authorization codes minted by /authorize, redeemable exactly once. */
  private readonly codes = new Map<string, { expiresAt: number }>()

  constructor(private readonly options: AuthOptions) {}

  private bearer(request: IncomingMessage): AuthSession | null {
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    return token ? this.options.sessions.findByAccess(token, Date.now()) : null
  }

  private sweepCodes(now: number): void {
    for (const [code, record] of this.codes) {
      if (record.expiresAt <= now) {
        this.codes.delete(code)
      }
    }
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    clientIp: string
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://auth.local')
    const path = url.pathname
    if (!path.startsWith('/v1/desktop/auth/')) {
      return false
    }
    const { logger, metrics, limiter } = this.options
    const endpoint = path.slice('/v1/desktop/auth/'.length)

    // Why limit here and not only at the edge: these endpoints mint grants and
    // sessions, and a self-hosted relay is normally reached by exactly one
    // desktop. Anything beyond a trickle is either a bug or an attack.
    const decision = limiter.take(`auth:${rateLimitKey(clientIp)}`)
    if (!decision.ok) {
      metrics.counter('manta_relay_rate_limited_total', 'Requests refused by a rate limiter.', {
        surface: 'auth'
      })
      json(
        response,
        429,
        { error: 'rate_limited' },
        {
          'retry-after': String(Math.ceil(decision.retryAfterMs / 1000))
        }
      )
      return true
    }

    const expectPost = (): boolean => {
      if (request.method === 'POST') {
        return true
      }
      json(response, 405, { error: 'method_not_allowed' }, { allow: 'POST' })
      return false
    }

    if (endpoint === 'authorize') {
      if (request.method !== 'GET') {
        json(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' })
        return true
      }
      // The desktop opens this in a browser with a loopback redirect_uri and a
      // PKCE challenge. A self-hosted single-user deployment has nobody to
      // authenticate, so the grant is immediate.
      const redirectUri = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state') ?? ''
      const clientId = url.searchParams.get('client_id') ?? ''
      if (!redirectUri || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(redirectUri)) {
        json(response, 400, { error: 'invalid_redirect_uri' })
        return true
      }
      if (this.options.expectedClientId && clientId !== this.options.expectedClientId) {
        json(response, 400, { error: 'invalid_client_id' })
        return true
      }
      const now = Date.now()
      this.sweepCodes(now)
      if (this.codes.size >= MAX_PENDING_CODES) {
        json(response, 429, { error: 'too_many_pending_grants' }, { 'retry-after': '60' })
        return true
      }
      const code = `code-${randomUUID()}`
      // Single use, short lived: without this /session would hand a session to
      // anyone who can reach the port, which is a full account takeover.
      this.codes.set(code, { expiresAt: now + CODE_TTL_MS })
      const target = new URL(redirectUri)
      target.searchParams.set('code', code)
      target.searchParams.set('state', state)
      logger.info('auth.authorize', { clientIp })
      response.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' })
      response.end()
      return true
    }

    if (endpoint === 'session') {
      if (!expectPost()) {
        return true
      }
      const body = await readJson(request)
      const { enrollmentSecret } = this.options
      if (enrollmentSecret) {
        // The gate lives here, not on /authorize. /authorize is a browser
        // navigation: the desktop cannot attach a header to it, so gating it
        // meant an HTML form and the secret travelling in a URL query string —
        // which then landed in the proxy's access log, and which browsers
        // silently broke via form-action CSP on the redirect.
        //
        // /session is a POST the desktop makes itself, so the secret rides in
        // the body: never in a URL, a log, or browser history. A code handed
        // out freely by /authorize is worthless without it.
        const offered = typeof body?.enrollmentSecret === 'string' ? body.enrollmentSecret : ''
        if (!constantTimeEqual(offered, enrollmentSecret)) {
          logger.warn('auth.enrollment_rejected', { clientIp, offered: offered !== '' })
          metrics.counter('manta_relay_auth_failures_total', 'Rejected auth requests.', {
            endpoint: 'session'
          })
          json(response, 401, { error: 'invalid_enrollment_secret' })
          return true
        }
      }
      const code = String(body?.code ?? '')
      const now = Date.now()
      this.sweepCodes(now)
      const record = this.codes.get(code)
      if (!record || record.expiresAt <= now) {
        logger.warn('auth.session.rejected', { clientIp, reason: 'invalid_grant' })
        metrics.counter('manta_relay_auth_failures_total', 'Rejected auth requests.', {
          endpoint: 'session'
        })
        json(response, 400, { error: 'invalid_grant' })
        return true
      }
      this.codes.delete(code)
      const tokens = this.options.sessions.create(this.options.sessionTtlMs, now)
      logger.info('auth.session.granted', { clientIp })
      metrics.counter('manta_relay_auth_sessions_total', 'Sessions minted.')
      json(response, 200, sessionBody(this.options.user, tokens))
      return true
    }

    if (endpoint === 'refresh') {
      if (!expectPost()) {
        return true
      }
      const body = await readJson(request)
      const now = Date.now()
      const existing = this.options.sessions.findByRefresh(String(body?.refreshToken ?? ''), now)
      if (!existing) {
        metrics.counter('manta_relay_auth_failures_total', 'Rejected auth requests.', {
          endpoint: 'refresh'
        })
        json(response, 401, { error: 'invalid_refresh_token' })
        return true
      }
      // Rotate: leaving the old refresh token usable means a stolen copy of the
      // state file grants sessions forever.
      this.options.sessions.remove(existing)
      json(
        response,
        200,
        sessionBody(this.options.user, this.options.sessions.create(this.options.sessionTtlMs, now))
      )
      return true
    }

    if (endpoint === 'capabilities' || endpoint === 'org') {
      if (!expectPost()) {
        return true
      }
      if (!this.bearer(request)) {
        json(response, 401, { error: 'unauthenticated' })
        return true
      }
      // Why the full envelope: the client reads `response.capabilities` and
      // `response.cloud`. A flat body normalizes to `{flags:{}}`, which is then
      // persisted — silently revoking relay.use and taking the relay offline
      // until the user signs in again.
      json(response, 200, identityBody(this.options.user))
      return true
    }

    if (endpoint === 'profile') {
      if (!expectPost()) {
        return true
      }
      // Semantically this creates a cloud profile and returns a *new session*;
      // a bare summary makes the client's assertString(accessToken) throw.
      if (!this.bearer(request)) {
        json(response, 401, { error: 'unauthenticated' })
        return true
      }
      json(
        response,
        200,
        sessionBody(
          this.options.user,
          this.options.sessions.create(this.options.sessionTtlMs, Date.now())
        )
      )
      return true
    }

    if (endpoint === 'logout') {
      if (!expectPost()) {
        return true
      }
      const session = this.bearer(request)
      if (session) {
        this.options.sessions.remove(session)
        logger.info('auth.logout', { clientIp })
      }
      json(response, 200, { ok: true })
      return true
    }

    if (endpoint === 'relay-token') {
      if (!expectPost()) {
        return true
      }
      if (!this.bearer(request)) {
        json(response, 401, { error: 'unauthenticated' })
        return true
      }
      const body = await readJson(request)
      const relayHostId = String(body?.relayHostId ?? '')
      if (!RELAY_HOST_ID_PATTERN.test(relayHostId)) {
        json(response, 422, { error: 'invalid_relay_host_id' })
        return true
      }
      const { user } = this.options
      const expiresAt = Date.now() + this.options.relayTokenTtlMs
      metrics.counter('manta_relay_tokens_issued_total', 'Relay tokens issued.')
      // The identity triple here must match what the desktop has locally, or its
      // byte-for-byte transcript comparison fails and pairing silently breaks.
      json(response, 200, {
        relayToken: issueRelayToken(
          {
            userId: user.userId,
            profileId: user.profileId,
            organizationId: user.organizationId,
            relayHostId,
            expiresAt
          },
          this.options.relayTokenSecret
        ),
        expiresAt
      })
      return true
    }

    json(response, 404, { error: 'not_found' })
    return true
  }
}
