const pinnedKeys = new Map<string, number>()

export function pinLocalImageCacheKey(key: string): void {
  pinnedKeys.set(key, (pinnedKeys.get(key) ?? 0) + 1)
}

export function unpinLocalImageCacheKey(key: string): void {
  const count = pinnedKeys.get(key)
  if (!count || count <= 1) {
    pinnedKeys.delete(key)
    return
  }
  pinnedKeys.set(key, count - 1)
}

export function isLocalImageCacheKeyPinned(key: string): boolean {
  return pinnedKeys.has(key)
}

export function clearLocalImageCachePins(): void {
  pinnedKeys.clear()
}

export function evictOldestUnpinnedLocalImageCacheEntry(
  cache: Map<string, string>,
  revoke: (url: string) => void
): boolean {
  const oldest = Array.from(cache.keys()).find((key) => !isLocalImageCacheKeyPinned(key))
  if (oldest === undefined) {
    return false
  }
  const url = cache.get(oldest)
  cache.delete(oldest)
  if (url) {
    revoke(url)
  }
  return true
}

export function prunePinnedLocalImageCache(
  cache: Map<string, string>,
  maxSize: number,
  revoke: (url: string) => void
): void {
  while (cache.size > maxSize) {
    if (!evictOldestUnpinnedLocalImageCacheEntry(cache, revoke)) {
      return
    }
  }
}
