/**
 * Minimal Manta Cloud auth surface.
 *
 * The desktop needs this only to obtain an identity and a relay token. Tokens
 * are opaque to the client, so this implements the smallest thing that
 * satisfies the contract: a loopback OAuth redirect, an enrolment-secret direct
 * grant, an email/password sign-in, and the relay-token issuer.
 *
 * `capabilities.flags["relay.use"]` must be true or the desktop gates the whole
 * relay path before ever contacting the director.
 *
 * Every endpoint except /authorize is POST — that is what the client sends, and
 * accepting GET would make the state-changing ones reachable from a plain link.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { json, readJson } from '../shared/http-json.js'
import { RELAY_HOST_ID_PATTERN } from '../shared/protocol.js'
import { rateLimitKey } from '../shared/client-ip.js'
import { issueRelayToken } from '../shared/relay-token.js'
import type { AuthAccount } from './accounts.js'
import type { AuthSession } from './store.js'
import { accountToUser, type AuthOptions } from './auth-options.js'
import { identityBody, sessionBody } from './identity.js'
import { handleLogin, handleRegister } from './account-endpoints.js'
import { handleAuthorize, handleEnrollmentSession, type PendingCodes } from './session-endpoints.js'
import {
  handleHostClaim,
  handleHostDescribe,
  handleHostForget,
  handleHostList
} from './host-directory.js'

export type { AuthUser, AuthOptions } from './auth-options.js'

type Caller = { session: AuthSession; account: AuthAccount }

export class RelayAuthServer {
  /** Authorization codes minted by /authorize, redeemable exactly once. */
  private readonly codes: PendingCodes = new Map()

  constructor(private readonly options: AuthOptions) {}

  /**
   * Resolves the bearer to a live session *and* the account behind it.
   *
   * A session whose account has gone is not merely unauthenticated: leaving it
   * in the table means the same 401 forever, so it is dropped here.
   */
  private caller(request: IncomingMessage): Caller | null {
    const header = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    const session = token ? this.options.sessions.findByAccess(token, Date.now()) : null
    if (!session) {
      return null
    }
    const account = this.options.accounts.byId(session.accountId)
    if (!account) {
      this.options.sessions.remove(session)
      return null
    }
    return { session, account }
  }

  private grant(response: ServerResponse, account: AuthAccount, grantKind: string): void {
    const tokens = this.options.sessions.create(
      account.accountId,
      this.options.sessionTtlMs,
      Date.now()
    )
    this.options.metrics.counter('manta_relay_auth_sessions_total', 'Sessions minted.', {
      grant: grantKind
    })
    json(response, 200, sessionBody(accountToUser(account), tokens))
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
    // sessions, and a self-hosted relay is normally reached by a handful of
    // desktops. Anything beyond a trickle is either a bug or an attack.
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
      handleAuthorize(url, request, response, this.options, this.codes)
      return true
    }

    if (endpoint === 'session') {
      if (expectPost()) {
        await handleEnrollmentSession(request, response, this.options, clientIp, this.codes)
      }
      return true
    }

    if (endpoint === 'register') {
      if (expectPost()) {
        await handleRegister(request, response, this.options, clientIp)
      }
      return true
    }

    if (endpoint === 'login') {
      if (expectPost()) {
        await handleLogin(request, response, this.options, clientIp)
      }
      return true
    }

    if (endpoint === 'refresh') {
      if (!expectPost()) {
        return true
      }
      const body = await readJson(request)
      const now = Date.now()
      const existing = this.options.sessions.findByRefresh(String(body?.refreshToken ?? ''), now)
      const account = existing ? this.options.accounts.byId(existing.accountId) : null
      if (!existing || !account) {
        if (existing) {
          this.options.sessions.remove(existing)
        }
        metrics.counter('manta_relay_auth_failures_total', 'Rejected auth requests.', {
          endpoint: 'refresh'
        })
        json(response, 401, { error: 'invalid_refresh_token' })
        return true
      }
      // Rotate: leaving the old refresh token usable means a stolen copy of the
      // state file grants sessions forever. The new one stays on the same
      // account — a refresh must never be able to change subject.
      this.options.sessions.remove(existing)
      this.grant(response, account, 'refresh')
      return true
    }

    if (endpoint === 'capabilities' || endpoint === 'org') {
      if (!expectPost()) {
        return true
      }
      const caller = this.caller(request)
      if (!caller) {
        json(response, 401, { error: 'unauthenticated' })
        return true
      }
      // Why the full envelope: the client reads `response.capabilities` and
      // `response.cloud`. A flat body normalizes to `{flags:{}}`, which is then
      // persisted — silently revoking relay.use and taking the relay offline
      // until the user signs in again.
      json(response, 200, identityBody(accountToUser(caller.account)))
      return true
    }

    if (endpoint === 'profile') {
      if (!expectPost()) {
        return true
      }
      // Semantically this creates a cloud profile and returns a *new session*;
      // a bare summary makes the client's assertString(accessToken) throw.
      const caller = this.caller(request)
      if (!caller) {
        json(response, 401, { error: 'unauthenticated' })
        return true
      }
      // Rotate rather than accumulate: the caller is replacing the session it
      // just used, and leaving the old one behind turns a repeatable endpoint
      // into a way to fill the session table.
      this.options.sessions.remove(caller.session)
      this.grant(response, caller.account, 'profile')
      return true
    }

    if (endpoint === 'logout') {
      if (!expectPost()) {
        return true
      }
      const caller = this.caller(request)
      if (caller) {
        this.options.sessions.remove(caller.session)
        logger.info('auth.logout', { clientIp })
      }
      json(response, 200, { ok: true })
      return true
    }

    if (
      endpoint === 'hosts' ||
      endpoint === 'host-describe' ||
      endpoint === 'host-forget' ||
      endpoint === 'host-claim'
    ) {
      if (!expectPost()) {
        return true
      }
      const caller = this.caller(request)
      if (!caller) {
        json(response, 401, { error: 'unauthenticated' })
        return true
      }
      const { accountId } = caller.account
      if (endpoint === 'hosts') {
        handleHostList(response, this.options, accountId)
      } else if (endpoint === 'host-describe') {
        await handleHostDescribe(request, response, this.options, accountId)
      } else if (endpoint === 'host-claim') {
        await handleHostClaim(request, response, this.options, accountId)
      } else {
        await handleHostForget(request, response, this.options, accountId)
      }
      return true
    }

    if (endpoint === 'relay-token') {
      if (expectPost()) {
        await this.onRelayToken(request, response)
      }
      return true
    }

    json(response, 404, { error: 'not_found' })
    return true
  }

  private async onRelayToken(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const caller = this.caller(request)
    if (!caller) {
      json(response, 401, { error: 'unauthenticated' })
      return
    }
    const body = await readJson(request)
    const relayHostId = String(body?.relayHostId ?? '')
    if (!RELAY_HOST_ID_PATTERN.test(relayHostId)) {
      json(response, 422, { error: 'invalid_relay_host_id' })
      return
    }
    const { account } = caller
    // First use claims the host id for this account; every later request from
    // anyone else is refused. Without it a second account could mint a token
    // for a host that is already paired and take over its phones.
    const claim = this.options.hosts.ownership.claim(
      relayHostId,
      account.accountId,
      this.options.maxHostsPerAccount
    )
    if (claim !== 'ok') {
      this.options.logger.warn('auth.relay_token_refused', { relayHostId, reason: claim })
      this.options.metrics.counter('manta_relay_auth_failures_total', 'Rejected auth requests.', {
        endpoint: 'relay-token'
      })
      json(response, claim === 'owned-by-other' ? 403 : 409, {
        error: claim === 'owned-by-other' ? 'host_owned_by_another_account' : 'too_many_hosts'
      })
      return
    }
    const expiresAt = Date.now() + this.options.relayTokenTtlMs
    this.options.metrics.counter('manta_relay_tokens_issued_total', 'Relay tokens issued.')
    // The identity triple here must match what the desktop has locally, or its
    // byte-for-byte transcript comparison fails and pairing silently breaks.
    json(response, 200, {
      relayToken: issueRelayToken(
        {
          userId: account.userId,
          profileId: account.profileId,
          organizationId: account.organizationId,
          relayHostId,
          accountId: account.accountId,
          expiresAt
        },
        this.options.relayTokenSecret
      ),
      expiresAt
    })
  }
}
