/**
 * Cell configuration.
 *
 * Its own module so the control leg can depend on the shape without importing
 * the cell itself, which would be circular.
 */
import type { CellStore } from './store.js'
import type { RelayTokenVerifier } from '../shared/relay-token.js'
import type { Logger } from '../shared/log.js'
import type { Metrics } from '../metrics.js'
import type { RateLimiter } from '../shared/rate-limit.js'

export type CellOptions = {
  /** This cell's canonical https origin; signed into every host challenge. */
  origin: string
  store: CellStore
  verifyRelayToken: RelayTokenVerifier
  /** Assignment epoch handed out by the director; hosts must match it. */
  assignmentEpoch: number
  resumeTtlMs: number
  graceTtlMs: number
  leaseTtlMs: number
  attachDeadlineMs: number
  maxInviteAttempts: number
  maxDevicesPerHost: number
  maxLiveInvitesPerHost: number
  maxLedgerEntriesPerHost: number
  /** Refuses new hosts past this point instead of degrading for everyone. */
  maxSessions: number
  maxConnsPerHost: number
  logger: Logger
  metrics: Metrics
  /** Buckets phone connects per source address. */
  phoneLimiter: RateLimiter
  /** Buckets phone connects per *known* host, in its own table. */
  hostConnectLimiter: RateLimiter
  /** Buckets control requests per host, so one desktop cannot spin the cell. */
  controlLimiter: RateLimiter
}
