/**
 * Token-bucket rate limiting.
 *
 * The relay's exposed surface is unauthenticated by design — a phone proves
 * itself only *after* the socket is open, and the director's resolve endpoint
 * has no bearer at all. Without a limiter those two are a free credential
 * oracle and a free memory allocator. Buckets are the right shape here because
 * a real phone is bursty (a scan, a reconnect storm after a network flap) but
 * has a low steady rate.
 *
 * Memory is bounded: the map is swept, and once it is full new keys are refused
 * rather than admitted, so filling it is a self-inflicted denial for the
 * attacker's own addresses instead of an allocation attack on us.
 */
export type RateLimitDecision = {
  ok: boolean
  /** Milliseconds until the next token; clients echo this as Retry-After. */
  retryAfterMs: number
}

export type RateLimitOptions = {
  /** Burst size. */
  capacity: number
  /** Sustained refill, tokens per second. */
  refillPerSecond: number
  /** Hard ceiling on tracked keys, so the limiter cannot be used to OOM us. */
  maxKeys?: number
}

type Bucket = { tokens: number; updatedAt: number }

const DEFAULT_MAX_KEYS = 20_000

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly capacity: number
  private readonly refillPerMs: number
  private readonly maxKeys: number

  constructor(
    options: RateLimitOptions,
    private readonly now: () => number = () => Date.now()
  ) {
    this.capacity = Math.max(1, options.capacity)
    this.refillPerMs = Math.max(0.001, options.refillPerSecond) / 1000
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
  }

  /** Consumes one token. A refusal reports when retrying can succeed. */
  take(key: string, cost = 1): RateLimitDecision {
    const now = this.now()
    let bucket = this.buckets.get(key)
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) {
        this.sweep(now)
      }
      if (this.buckets.size >= this.maxKeys) {
        // Refuse rather than grow. The alternative — evicting a random existing
        // bucket — lets an attacker reset a limit they are already hitting.
        return { ok: false, retryAfterMs: Math.ceil(1 / this.refillPerMs) }
      }
      bucket = { tokens: this.capacity, updatedAt: now }
      this.buckets.set(key, bucket)
    }
    const elapsed = Math.max(0, now - bucket.updatedAt)
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs)
    bucket.updatedAt = now
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      return { ok: true, retryAfterMs: 0 }
    }
    return { ok: false, retryAfterMs: Math.ceil((cost - bucket.tokens) / this.refillPerMs) }
  }

  /** Returns a consumed token, e.g. when a request turned out to be legitimate. */
  refund(key: string, cost = 1): void {
    const bucket = this.buckets.get(key)
    if (bucket) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + cost)
    }
  }

  /** Drops buckets that have refilled completely; they carry no information. */
  sweep(now = this.now()): void {
    const full = this.capacity / this.refillPerMs
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt >= full) {
        this.buckets.delete(key)
      }
    }
  }

  get size(): number {
    return this.buckets.size
  }
}
