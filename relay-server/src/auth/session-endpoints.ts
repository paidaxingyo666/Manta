/**
 * The two endpoints that existed before accounts did.
 *
 * `/authorize` and the enrolment-secret `/session` grant are kept working
 * unchanged and bound to the legacy account: every desktop already in the field
 * uses one of them, and removing either would turn an upgrade into a
 * sign-out for the whole deployment.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { json, readJson } from '../shared/http-json.js'
import { constantTimeEqual, accountToUser, type AuthOptions } from './auth-options.js'
import { sessionBody } from './identity.js'

const CODE_TTL_MS = 5 * 60_000
/** An unredeemed code is a pending grant; a few is normal, thousands is abuse. */
const MAX_PENDING_CODES = 32

export type PendingCodes = Map<string, { expiresAt: number }>

function sweep(codes: PendingCodes, now: number): void {
  for (const [code, record] of codes) {
    if (record.expiresAt <= now) {
      codes.delete(code)
    }
  }
}

function grant(
  response: ServerResponse,
  options: AuthOptions,
  accountId: string,
  kind: string
): boolean {
  const account = options.accounts.byId(accountId)
  if (!account) {
    json(response, 500, { error: 'legacy_account_missing' })
    return false
  }
  const tokens = options.sessions.create(account.accountId, options.sessionTtlMs, Date.now())
  options.metrics.counter('manta_relay_auth_sessions_total', 'Sessions minted.', { grant: kind })
  json(response, 200, sessionBody(accountToUser(account), tokens))
  return true
}

export function handleAuthorize(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthOptions,
  codes: PendingCodes
): void {
  if (request.method !== 'GET') {
    json(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' })
    return
  }
  // The desktop opens this in a browser with a loopback redirect_uri and a PKCE
  // challenge. A self-hosted deployment has no identity provider to hand off
  // to, so the grant is immediate and the enrolment secret on /session is what
  // actually gates it.
  const redirectUri = url.searchParams.get('redirect_uri')
  const state = url.searchParams.get('state') ?? ''
  const clientId = url.searchParams.get('client_id') ?? ''
  if (!redirectUri || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(redirectUri)) {
    json(response, 400, { error: 'invalid_redirect_uri' })
    return
  }
  if (options.expectedClientId && clientId !== options.expectedClientId) {
    json(response, 400, { error: 'invalid_client_id' })
    return
  }
  const now = Date.now()
  sweep(codes, now)
  if (codes.size >= MAX_PENDING_CODES) {
    json(response, 429, { error: 'too_many_pending_grants' }, { 'retry-after': '60' })
    return
  }
  const code = `code-${randomUUID()}`
  // Single use, short lived: without this /session would hand a session to
  // anyone who can reach the port, which is a full account takeover.
  codes.set(code, { expiresAt: now + CODE_TTL_MS })
  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  target.searchParams.set('state', state)
  options.logger.info('auth.authorize')
  response.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' })
  response.end()
}

export async function handleEnrollmentSession(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthOptions,
  clientIp: string,
  codes: PendingCodes
): Promise<void> {
  const { logger, metrics, enrollmentSecret } = options
  const body = await readJson(request)
  const fail = (status: number, error: string): void => {
    metrics.counter('manta_relay_auth_failures_total', 'Rejected auth requests.', {
      endpoint: 'session'
    })
    json(response, status, { error })
  }
  if (enrollmentSecret) {
    // The gate lives here, not on /authorize. /authorize is a browser
    // navigation: the desktop cannot attach a header to it, so gating it meant
    // an HTML form and the secret travelling in a URL query string — which then
    // landed in the proxy's access log, and which browsers silently broke via
    // form-action CSP on the redirect.
    const offered = typeof body?.enrollmentSecret === 'string' ? body.enrollmentSecret : ''
    if (!constantTimeEqual(offered, enrollmentSecret)) {
      logger.warn('auth.enrollment_rejected', { clientIp, offered: offered !== '' })
      fail(401, 'invalid_enrollment_secret')
      return
    }
  }
  // The shared identity is the whole point of a shared relay and the whole
  // problem on a per-user one: granting it there would hand someone an
  // identity every other holder of the enrolment secret also has, from a
  // button that says "sign in".
  if (options.accountsMode === 'per-user') {
    fail(409, 'accounts_required')
    return
  }
  const now = Date.now()
  const code = String(body?.code ?? '')
  // Direct grant: no authorization code, no browser. The enrolment secret is
  // the credential either way, so skipping the round trip removes a step
  // without removing a check. Only offered when a secret is configured:
  // without one there would be nothing left to prove.
  if (!code) {
    if (!enrollmentSecret) {
      json(response, 400, { error: 'direct_grant_unavailable' })
      return
    }
    if (grant(response, options, options.legacyAccountId, 'direct')) {
      logger.info('auth.session.granted', { clientIp, grant: 'direct' })
    }
    return
  }
  sweep(codes, now)
  const record = codes.get(code)
  if (!record || record.expiresAt <= now) {
    logger.warn('auth.session.rejected', { clientIp, reason: 'invalid_grant' })
    fail(400, 'invalid_grant')
    return
  }
  codes.delete(code)
  if (grant(response, options, options.legacyAccountId, 'code')) {
    logger.info('auth.session.granted', { clientIp, grant: 'code' })
  }
}
