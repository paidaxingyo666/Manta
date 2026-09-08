import type * as Crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Slug allocation, with the random source under the test's control.
 *
 * Forced rather than waited for: at ninety-six bits a real collision will not
 * happen in a test run, and the consequence — one account's page overwritten by
 * another's, served under a link already handed out — is worth a proof rather
 * than an argument about odds.
 */
const nextBytes: Buffer[] = []

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>()
  return {
    ...actual,
    randomBytes: (size: number) => nextBytes.shift() ?? actual.randomBytes(size)
  }
})

const { ArtifactStore } = await import('./store.js')
type ArtifactWrite = Parameters<InstanceType<typeof ArtifactStore>['create']>[0]

const QUOTA = { maxPerAccount: 100, maxTotalBytesPerAccount: 1024 * 1024 }

function store(): InstanceType<typeof ArtifactStore> {
  // No data directory: bodies stay in memory, keyed by slug, which is what
  // makes the slug the only thing separating one page's storage from another's.
  return new ArtifactStore(null, () => {}, QUOTA, 'test-secret')
}

function write(overrides: Partial<ArtifactWrite> = {}): ArtifactWrite {
  return {
    accountId: 'acct-a',
    title: null,
    originalFileName: 'a.html',
    sourceContentType: 'text/html',
    byteSize: 10,
    html: '<h1>a</h1>',
    ttlMs: 60_000,
    ...overrides
  }
}

beforeEach(() => {
  nextBytes.length = 0
})

afterEach(() => {
  nextBytes.length = 0
})

describe('slug allocation', () => {
  it('refuses a slug already taken and draws another', () => {
    const collision = Buffer.alloc(12, 7)
    const free = Buffer.alloc(12, 9)
    nextBytes.push(collision, collision, free)

    const subject = store()
    const first = subject.create(write(), Date.now(), null)
    const second = subject.create(
      write({ accountId: 'acct-b', html: '<h1>b</h1>' }),
      Date.now(),
      null
    )

    expect(second.record.slug).not.toBe(first.record.slug)
    // The proof that matters: neither page was overwritten by the other.
    expect(subject.readBody(first.record.slug)).toBe('<h1>a</h1>')
    expect(subject.readBody(second.record.slug)).toBe('<h1>b</h1>')
  })

  it('refuses a slug an expired record still holds', () => {
    // An expired record keeps its stored page until the sweep runs, so reusing
    // its slug would clobber a page whose link is still in someone's hands.
    const expired = Buffer.alloc(12, 1)
    nextBytes.push(expired, expired, Buffer.alloc(12, 2))

    const subject = store()
    const stale = subject.create(write({ ttlMs: 1 }), Date.now() - 10_000, null)
    expect(subject.find(stale.record.slug, Date.now())).toBeNull()

    const next = subject.create(write({ html: '<h1>next</h1>' }), Date.now(), null)
    expect(next.record.slug).not.toBe(stale.record.slug)
    expect(subject.readBody(stale.record.slug)).toBe('<h1>a</h1>')
  })

  it('gives up rather than serve one account page from another account link', () => {
    // A source that only ever returns one value is broken, not unlucky, and
    // carrying on would mean exactly the overwrite this guard exists to stop.
    const only = Buffer.alloc(12, 5)
    const subject = store()
    nextBytes.push(only)
    const first = subject.create(write(), Date.now(), null)

    for (let i = 0; i < 16; i += 1) {
      nextBytes.push(only)
    }
    expect(() => subject.create(write({ accountId: 'acct-b' }), Date.now(), null)).toThrow(
      'artifact_slug_unavailable'
    )
    expect(subject.readBody(first.record.slug)).toBe('<h1>a</h1>')
  })
})
