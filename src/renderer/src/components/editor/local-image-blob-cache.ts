import {
  clearLocalImageCachePins,
  evictOldestUnpinnedLocalImageCacheEntry,
  pinLocalImageCacheKey,
  prunePinnedLocalImageCache,
  unpinLocalImageCacheKey
} from './local-image-cache-pinning'

const MAX_ENTRIES = 100
const blobUrls = new Map<string, string>()
const inFlightLoads = new Map<string, Promise<string | null>>()
const slotReservations = new Map<string, symbol>()
const invalidationListeners = new Set<() => void>()
const capacityListeners = new Set<() => void>()
const pendingRevocations = new Set<string>()

export const LOCAL_IMAGE_CACHE_CAPACITY_BLOCKED = Symbol('local-image-cache-capacity-blocked')

let generation = 0
let capacityNotificationQueued = false
let revocationTimer: ReturnType<typeof setTimeout> | null = null

export function getLocalImageCacheGeneration(): number {
  return generation
}

export function getCachedLocalImageBlobUrl(key: string): string | undefined {
  return blobUrls.get(key)
}

export function getInFlightLocalImageLoad(key: string): Promise<string | null> | undefined {
  return inFlightLoads.get(key)
}

export function setInFlightLocalImageLoad(key: string, load: Promise<string | null>): void {
  inFlightLoads.set(key, load)
}

export function deleteInFlightLocalImageLoad(key: string, load: Promise<string | null>): void {
  if (inFlightLoads.get(key) === load) {
    inFlightLoads.delete(key)
  }
}

export function reserveLocalImageCacheSlot(key: string): symbol | null {
  while (blobUrls.size + slotReservations.size >= MAX_ENTRIES) {
    if (!evictOldestUnpinnedLocalImageCacheEntry(blobUrls, URL.revokeObjectURL)) {
      return null
    }
  }
  const token = Symbol(key)
  slotReservations.set(key, token)
  return token
}

export function releaseLocalImageCacheSlot(key: string, token: symbol): void {
  if (slotReservations.get(key) !== token) {
    return
  }
  slotReservations.delete(key)
  notifyCapacityAvailable()
}

export function cacheLocalImageBlobUrl(key: string, url: string): void {
  const previousUrl = blobUrls.get(key)
  if (previousUrl !== undefined) {
    blobUrls.delete(key)
    if (previousUrl !== url) {
      URL.revokeObjectURL(previousUrl)
    }
  }
  blobUrls.set(key, url)
  prunePinnedLocalImageCache(blobUrls, MAX_ENTRIES, URL.revokeObjectURL)
}

export function pinLocalImageBlobUrl(key: string): void {
  pinLocalImageCacheKey(key)
}

export function unpinLocalImageBlobUrl(key: string): void {
  unpinLocalImageCacheKey(key)
  prunePinnedLocalImageCache(blobUrls, MAX_ENTRIES, URL.revokeObjectURL)
  notifyCapacityAvailable()
}

export function onLocalImageCacheCapacityAvailable(listener: () => void): () => void {
  capacityListeners.add(listener)
  return () => capacityListeners.delete(listener)
}

export function onImageCacheInvalidated(listener: () => void): () => void {
  invalidationListeners.add(listener)
  return () => invalidationListeners.delete(listener)
}

function notifyCapacityAvailable(): void {
  if (capacityNotificationQueued) {
    return
  }
  capacityNotificationQueued = true
  queueMicrotask(() => {
    capacityNotificationQueued = false
    // Snapshot: a listener may unsubscribe itself, or reset() may clear the set.
    for (const listener of Array.from(capacityListeners)) {
      listener()
    }
  })
}

function revokePendingBlobUrls(): void {
  revocationTimer = null
  for (const url of pendingRevocations) {
    URL.revokeObjectURL(url)
  }
  pendingRevocations.clear()
}

function scheduleBlobUrlRevocation(urls: string[]): void {
  for (const url of urls) {
    pendingRevocations.add(url)
  }
  if (revocationTimer !== null || pendingRevocations.size === 0) {
    return
  }
  revocationTimer = setTimeout(revokePendingBlobUrls, 30_000)
}

export function invalidateLocalImageCache(): void {
  if (revocationTimer !== null) {
    clearTimeout(revocationTimer)
    revocationTimer = null
    revokePendingBlobUrls()
  }
  const staleUrls = Array.from(blobUrls.values())
  blobUrls.clear()
  inFlightLoads.clear()
  slotReservations.clear()
  generation += 1
  for (const listener of invalidationListeners) {
    listener()
  }
  if (staleUrls.length > 0) {
    scheduleBlobUrlRevocation(staleUrls)
  }
  notifyCapacityAvailable()
}

export function resetLocalImageBlobCache(): void {
  if (revocationTimer !== null) {
    clearTimeout(revocationTimer)
    revocationTimer = null
  }
  revokePendingBlobUrls()
  for (const url of blobUrls.values()) {
    URL.revokeObjectURL(url)
  }
  blobUrls.clear()
  clearLocalImageCachePins()
  inFlightLoads.clear()
  slotReservations.clear()
  generation += 1
  pendingRevocations.clear()
  capacityListeners.clear()
  invalidationListeners.clear()
}

function disposeLocalImageBlobCache(): void {
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', invalidateLocalImageCache)
  }
  resetLocalImageBlobCache()
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', invalidateLocalImageCache)
}

if (import.meta !== undefined && import.meta.hot) {
  import.meta.hot.dispose(disposeLocalImageBlobCache)
}
