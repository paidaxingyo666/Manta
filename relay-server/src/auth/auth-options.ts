/**
 * What the auth surface is wired with.
 *
 * Kept apart from the request handlers so the endpoint modules can share the
 * shape without importing each other — the register/login and host-directory
 * handlers both need it, and a cycle through `server.ts` would be resolved at
 * runtime in whichever order the loader happened to pick.
 */
import { timingSafeEqual } from 'node:crypto'
import type { AccountStore, AuthAccount } from './accounts.js'
import type { AuthSessionStore } from './store.js'
import type { CellStore } from '../cell/store.js'
import type { Logger } from '../shared/log.js'
import type { Metrics } from '../metrics.js'
import type { RateLimiter } from '../shared/rate-limit.js'

/** The identity envelope fields, projected from an account. */
export type AuthUser = {
  userId: string
  profileId: string
  organizationId: string
  email: string
  displayName: string
}

/**
 * Who may create an account.
 *
 * 'enrollment-secret' is the default wherever a secret is configured: the relay
 * is already reachable from the internet there, and open signup would hand a
 * stranger a relay token and a control leg.
 */
export type RegistrationMode = 'open' | 'enrollment-secret' | 'disabled'

export type AuthOptions = {
  accounts: AccountStore
  /** Account that owns everything written before accounts existed. */
  legacyAccountId: string
  hosts: CellStore
  /** Whether a host id currently holds a live control leg on this cell. */
  isHostOnline: (relayHostId: string) => boolean
  /**
   * Cuts a host's live session and everything paired through it.
   *
   * Retiring a machine has to reach the cell, not just the store: a control leg
   * that survives its own record keeps forwarding, and the desktop's cached
   * relay token stays valid for the rest of its hour. Without this, "forget
   * this machine" is a claim the relay does not honour.
   */
  disconnectHost: (relayHostId: string) => void
  maxHostsPerAccount: number
  registrationMode: RegistrationMode
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

export function accountToUser(account: AuthAccount): AuthUser {
  return {
    userId: account.userId,
    profileId: account.profileId,
    organizationId: account.organizationId,
    email: account.email,
    displayName: account.displayName
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}
