import { RateLimiter } from './rate-limit.js'
import type { RelayConfig } from '../config.js'

/**
 * The five token buckets the relay charges, built together so their
 * relationships stay visible: they share the same config block, and two of them
 * deliberately reuse the phone budget rather than having one of their own.
 */
export type RelayRateLimiters = {
  http: RateLimiter
  auth: RateLimiter
  phone: RateLimiter
  hostConnect: RateLimiter
  control: RateLimiter
}

export function createRelayRateLimiters(config: RelayConfig): RelayRateLimiters {
  return {
    http: new RateLimiter({
      capacity: config.limits.httpBurst,
      refillPerSecond: config.limits.httpPerSecond
    }),
    auth: new RateLimiter({
      capacity: config.limits.authBurst,
      refillPerSecond: config.limits.authPerSecond
    }),
    phone: new RateLimiter({
      capacity: config.limits.phoneBurst,
      refillPerSecond: config.limits.phonePerSecond
    }),
    // Its own table, keyed by host id. Bounded by maxSessions because the key is
    // only ever charged for a host that is actually online.
    hostConnect: new RateLimiter({
      capacity: config.limits.phoneBurst,
      refillPerSecond: config.limits.phonePerSecond,
      maxKeys: Math.max(64, config.maxSessions * 4)
    }),
    control: new RateLimiter({
      capacity: config.limits.controlBurst,
      refillPerSecond: config.limits.controlPerSecond
    })
  }
}
