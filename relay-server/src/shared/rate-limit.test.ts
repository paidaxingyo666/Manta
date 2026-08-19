import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rate-limit.js'

describe('RateLimiter', () => {
  it('allows a burst, then refills over time', () => {
    let now = 1_000
    const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1 }, () => now)
    expect([1, 2, 3].map(() => limiter.take('a').ok)).toEqual([true, true, true])
    const refused = limiter.take('a')
    expect(refused.ok).toBe(false)
    // The client echoes this as Retry-After, so it must be a real wait.
    expect(refused.retryAfterMs).toBeGreaterThan(0)
    now += refused.retryAfterMs
    expect(limiter.take('a').ok).toBe(true)
  })

  it('keeps buckets independent per key', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 0.001 }, () => 0)
    expect(limiter.take('a').ok).toBe(true)
    expect(limiter.take('a').ok).toBe(false)
    expect(limiter.take('b').ok).toBe(true)
  })

  it('refuses new keys instead of growing past its ceiling', () => {
    // Evicting an existing bucket would let an attacker reset a limit they are
    // already hitting, so a full table refuses rather than makes room.
    const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 0.001, maxKeys: 2 }, () => 0)
    expect(limiter.take('a').ok).toBe(true)
    expect(limiter.take('b').ok).toBe(true)
    expect(limiter.take('c').ok).toBe(false)
    expect(limiter.size).toBe(2)
  })

  it('forgets buckets that have fully refilled', () => {
    let now = 0
    const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 1 }, () => now)
    limiter.take('a')
    expect(limiter.size).toBe(1)
    now += 2_000
    limiter.sweep()
    expect(limiter.size).toBe(0)
  })
})
