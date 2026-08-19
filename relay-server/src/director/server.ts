/**
 * The director: hands a desktop the cell it should use, and helps a phone find
 * a host that moved.
 *
 *   POST /v1/assign            (Bearer relayToken)  -> cellUrl + epoch + lease
 *   POST /v1/resolve           (no auth; the resume token is the credential)
 *   GET  /v1/regions           intentionally 404 — see below
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  CLOSE_CODES,
  RELAY_HOST_ID_PATTERN,
  TOKEN_PATTERN,
  isCanonicalHttpsOrigin
} from '../shared/protocol.js'
import type { RelayTokenVerifier } from '../shared/relay-token.js'
import type { Logger } from '../shared/log.js'
import type { Metrics } from '../metrics.js'
import type { RateLimiter } from '../shared/rate-limit.js'
import { rateLimitKey } from '../shared/client-ip.js'

export type DirectorOptions = {
  /** Single-cell deployments point every host at the same origin. */
  cellUrl: string
  assignmentEpoch: number
  leaseTtlMs: number
  verifyRelayToken: RelayTokenVerifier
  logger: Logger
  metrics: Metrics
  /** /v1/resolve has no bearer at all, so the limiter is its only gate. */
  limiter: RateLimiter
}

const MAX_BODY_BYTES = 16 * 1024

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

export class RelayDirector {
  constructor(private readonly options: DirectorOptions) {
    if (
      !isCanonicalHttpsOrigin(options.cellUrl) &&
      !options.cellUrl.startsWith('http://127.0.0.1')
    ) {
      throw new Error(`cellUrl must be a canonical https origin: ${options.cellUrl}`)
    }
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    clientIp: string
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://director.local')
    const path = url.pathname
    if (path !== '/v1/assign' && path !== '/v1/resolve' && path !== '/v1/regions') {
      return false
    }
    const decision = this.options.limiter.take(`director:${rateLimitKey(clientIp)}`)
    if (!decision.ok) {
      this.options.metrics.counter(
        'manta_relay_rate_limited_total',
        'Requests refused by a rate limiter.',
        {
          surface: 'director'
        }
      )
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
    if (request.method === 'POST' && path === '/v1/assign') {
      await this.assign(request, response, clientIp)
      return true
    }
    if (request.method === 'POST' && path === '/v1/resolve') {
      await this.resolve(request, response)
      return true
    }
    if (request.method === 'GET' && path === '/v1/regions') {
      // Why 404 rather than a catalog: the desktop silently degrades to an
      // assignment without a region preference, which is exactly right for a
      // single-region self-hosted deployment. Serving a catalog would also drag
      // in the probeOrigin hostname-suffix rules for no benefit.
      json(response, 404, { error: 'regions_not_configured' })
      return true
    }
    json(response, 405, { error: 'method_not_allowed' })
    return true
  }

  private async assign(
    request: IncomingMessage,
    response: ServerResponse,
    clientIp: string
  ): Promise<void> {
    const auth = request.headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    const claims = token ? this.options.verifyRelayToken(token) : null
    if (!claims) {
      this.options.logger.warn('director.assign.rejected', { clientIp })
      // Never 400 here: the desktop treats 400 as "retry without a field" and
      // does not retry it as a transient failure.
      json(response, 401, { error: 'invalid_relay_token' })
      return
    }
    const body = await readJson(request)
    const relayHostId = String(body?.relayHostId ?? '')
    if (!RELAY_HOST_ID_PATTERN.test(relayHostId)) {
      json(response, 422, { error: 'invalid_relay_host_id' })
      return
    }
    this.options.metrics.counter('manta_relay_assignments_total', 'Cell assignments handed out.')
    json(response, 200, {
      v: 1,
      cellUrl: this.options.cellUrl,
      assignmentEpoch: this.options.assignmentEpoch,
      // The desktop never reads `lease`, but its schema requires a non-empty
      // string; omitting it fails the whole response.
      lease: `lease-${Date.now().toString(36)}`
    })
  }

  private async resolve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request)
    const relayHostId = String(body?.relayHostId ?? '')
    const resumeToken = String(body?.resumeToken ?? '')
    // The token is not checked against the store on purpose: this endpoint is
    // only a pointer to a cell, and answering differently for a known and an
    // unknown token would turn it into an oracle for guessing credentials.
    if (!RELAY_HOST_ID_PATTERN.test(relayHostId) || !TOKEN_PATTERN.test(resumeToken)) {
      json(response, 422, { error: 'invalid_resolve_request' })
      return
    }
    json(response, 200, {
      v: 1,
      cellUrl: this.options.cellUrl,
      assignmentEpoch: this.options.assignmentEpoch,
      leaseExpiresAt: Date.now() + this.options.leaseTtlMs
    })
  }

  /**
   * Invite-time relocation. A single-cell deployment has nowhere else to send
   * the phone, so it is told the current cell — the client requires a strictly
   * greater epoch, hence closing instead when it would not advance.
   */
  handleConnectSocket(socket: {
    send: (data: string) => void
    close: (code: number, reason: string) => void
  }): void {
    socket.close(CLOSE_CODES.HOST_OFFLINE, 'no relocation target')
  }
}
