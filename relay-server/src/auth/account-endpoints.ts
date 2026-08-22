/**
 * Register and sign in.
 *
 * These live under the same `/v1/desktop/auth/` prefix as everything else so a
 * desktop can feature-detect by calling one: a relay built before accounts
 * existed answers 404, which the client reads as "this relay only does
 * enrolment secrets" rather than as a failure.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { json, readJson } from '../shared/http-json.js'
import { rateLimitKey } from '../shared/client-ip.js'
import { isPlausibleEmail, normalizeEmail, type AuthAccount } from './accounts.js'
import {
  hashPassword,
  verifyPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH
} from './password.js'
import { accountToUser, constantTimeEqual, type AuthOptions } from './auth-options.js'
import { sessionBody } from './identity.js'

/**
 * Hashed on first use and compared against when the email is unknown.
 *
 * Answering an unknown address instantly and a known one after a full scrypt
 * derivation is a free account-enumeration oracle, so both paths do the work.
 */
let decoyHash: Promise<string> | null = null
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(`decoy-${Math.random()}`)
  return decoyHash
}

function readCredentials(body: Record<string, unknown> | null): {
  email: string
  password: string
} | null {
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) {
    return null
  }
  return { email, password }
}

function grant(
  response: ServerResponse,
  options: AuthOptions,
  account: AuthAccount,
  grantKind: string
): void {
  const tokens = options.sessions.create(account.accountId, options.sessionTtlMs, Date.now())
  options.metrics.counter('manta_relay_auth_sessions_total', 'Sessions minted.', {
    grant: grantKind
  })
  json(response, 200, sessionBody(accountToUser(account), tokens))
}

function refuse(
  response: ServerResponse,
  options: AuthOptions,
  status: number,
  error: string,
  endpoint: string
): void {
  options.metrics.counter('manta_relay_auth_failures_total', 'Rejected auth requests.', {
    endpoint
  })
  json(response, status, { error })
}

export async function handleRegister(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthOptions,
  clientIp: string
): Promise<void> {
  const { registrationMode, enrollmentSecret, logger } = options
  if (registrationMode === 'disabled') {
    refuse(response, options, 403, 'registration_disabled', 'register')
    return
  }
  const body = await readJson(request)
  if (registrationMode === 'enrollment-secret') {
    const offered = typeof body?.enrollmentSecret === 'string' ? body.enrollmentSecret : ''
    if (!enrollmentSecret || !constantTimeEqual(offered, enrollmentSecret)) {
      logger.warn('auth.register_rejected', { clientIp, reason: 'invalid_enrollment_secret' })
      refuse(response, options, 401, 'invalid_enrollment_secret', 'register')
      return
    }
  }
  const credentials = readCredentials(body)
  if (!credentials || !isPlausibleEmail(normalizeEmail(credentials.email))) {
    refuse(response, options, 400, 'invalid_email', 'register')
    return
  }
  if (
    credentials.password.length < MIN_PASSWORD_LENGTH ||
    credentials.password.length > MAX_PASSWORD_LENGTH
  ) {
    refuse(response, options, 400, 'weak_password', 'register')
    return
  }
  if (options.accounts.byEmail(credentials.email)) {
    refuse(response, options, 409, 'email_taken', 'register')
    return
  }
  if (options.accounts.atCapacity) {
    refuse(response, options, 503, 'too_many_accounts', 'register')
    return
  }
  const displayName = typeof body?.displayName === 'string' ? body.displayName.slice(0, 120) : ''
  const account = options.accounts.create({
    email: credentials.email,
    displayName,
    passwordHash: await hashPassword(credentials.password),
    now: Date.now()
  })
  if (!account) {
    // Lost a race against a concurrent registration for the same address.
    refuse(response, options, 409, 'email_taken', 'register')
    return
  }
  logger.info('auth.registered', { clientIp, accountId: account.accountId })
  grant(response, options, account, 'register')
}

export async function handleLogin(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthOptions,
  clientIp: string
): Promise<void> {
  const sourceKey = rateLimitKey(clientIp)
  const body = await readJson(request)
  const credentials = readCredentials(body)
  if (!credentials) {
    refuse(response, options, 400, 'invalid_request', 'login')
    return
  }
  // A second bucket, keyed on the address *and* the source. Keyed on the
  // address alone it is a lockout primitive: anyone who knows a colleague's
  // email can hold their bucket at zero and refuse them from every network.
  // Per source-and-address still costs a botnet one bucket per node, which is
  // what the cross-source grind this exists to stop actually needs.
  const attemptKey = `login:${sourceKey}:${normalizeEmail(credentials.email)}`
  const perAccount = options.limiter.take(attemptKey)
  if (!perAccount.ok) {
    options.metrics.counter(
      'manta_relay_rate_limited_total',
      'Requests refused by a rate limiter.',
      { surface: 'login' }
    )
    json(
      response,
      429,
      { error: 'rate_limited' },
      { 'retry-after': String(Math.ceil(perAccount.retryAfterMs / 1000)) }
    )
    return
  }
  const account = options.accounts.byEmail(credentials.email)
  const ok = await verifyPassword(credentials.password, account?.passwordHash ?? (await decoy()))
  if (!account || !ok) {
    options.logger.warn('auth.login_rejected', { clientIp })
    refuse(response, options, 401, 'invalid_credentials', 'login')
    return
  }
  // A successful sign-in should not leave the bucket drained for the next
  // legitimate one; only failures are worth counting.
  options.limiter.refund(attemptKey)
  options.logger.info('auth.login', { clientIp, accountId: account.accountId })
  grant(response, options, account, 'password')
}
