import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearLocalImageCachePins,
  evictOldestUnpinnedLocalImageCacheEntry,
  isLocalImageCacheKeyPinned,
  pinLocalImageCacheKey,
  prunePinnedLocalImageCache,
  unpinLocalImageCacheKey
} from './local-image-cache-pinning'

afterEach(() => clearLocalImageCachePins())

describe('local image cache pinning', () => {
  it('keeps a key pinned until every mounted consumer releases it', () => {
    pinLocalImageCacheKey('image')
    pinLocalImageCacheKey('image')
    unpinLocalImageCacheKey('image')
    expect(isLocalImageCacheKeyPinned('image')).toBe(true)

    unpinLocalImageCacheKey('image')
    expect(isLocalImageCacheKeyPinned('image')).toBe(false)
  })

  it('evicts the oldest unpinned URL without breaking mounted images', () => {
    const cache = new Map([
      ['mounted', 'blob:mounted'],
      ['oldest-free', 'blob:oldest-free'],
      ['newest-free', 'blob:newest-free']
    ])
    const revoke = vi.fn()
    pinLocalImageCacheKey('mounted')

    prunePinnedLocalImageCache(cache, 2, revoke)

    expect([...cache.keys()]).toEqual(['mounted', 'newest-free'])
    expect(revoke).toHaveBeenCalledWith('blob:oldest-free')
  })

  it('refuses admission when every resident URL is mounted', () => {
    const cache = new Map([['mounted', 'blob:mounted']])
    const revoke = vi.fn()
    pinLocalImageCacheKey('mounted')

    expect(evictOldestUnpinnedLocalImageCacheEntry(cache, revoke)).toBe(false)
    expect(cache.size).toBe(1)
    expect(revoke).not.toHaveBeenCalled()
  })

  it('prunes overflow after the final mounted consumer releases a slot', () => {
    const cache = new Map([
      ['first', 'blob:first'],
      ['second', 'blob:second']
    ])
    const revoke = vi.fn()
    pinLocalImageCacheKey('first')
    pinLocalImageCacheKey('second')
    prunePinnedLocalImageCache(cache, 1, revoke)
    expect(cache.size).toBe(2)

    unpinLocalImageCacheKey('first')
    prunePinnedLocalImageCache(cache, 1, revoke)
    expect([...cache.keys()]).toEqual(['second'])
    expect(revoke).toHaveBeenCalledWith('blob:first')
  })
})
