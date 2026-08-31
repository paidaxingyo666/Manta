import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveImageAbsolutePath } from './markdown-preview-links'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import { readRuntimeFilePreview } from '@/runtime/runtime-file-client'
import {
  cacheLocalImageBlobUrl,
  deleteInFlightLocalImageLoad,
  getCachedLocalImageBlobUrl,
  getInFlightLocalImageLoad,
  getLocalImageCacheGeneration,
  invalidateLocalImageCache,
  LOCAL_IMAGE_CACHE_CAPACITY_BLOCKED,
  onImageCacheInvalidated,
  onLocalImageCacheCapacityAvailable,
  pinLocalImageBlobUrl,
  releaseLocalImageCacheSlot,
  reserveLocalImageCacheSlot,
  resetLocalImageBlobCache,
  setInFlightLocalImageLoad,
  unpinLocalImageBlobUrl
} from './local-image-blob-cache'

// Why: the renderer is served from http://localhost in dev mode, so file://
// URLs in <img> tags are blocked by cross-origin restrictions. Loading images
// via the existing fs.readFile IPC and converting to blob URLs bypasses this
// limitation and works identically in both dev and production modes.

type LocalImageLoadResult = string | null | typeof LOCAL_IMAGE_CACHE_CAPACITY_BLOCKED
type LocalImageRuntimeContext = Omit<RuntimeFileOperationArgs, 'connectionId'> & {
  connectionId?: string | null
}

export function getLocalImageCacheKey(
  absolutePath: string,
  connectionId?: string | null,
  runtimeContext?: LocalImageRuntimeContext
): string {
  const runtimeEnvironmentId =
    runtimeContext?.settings?.activeRuntimeEnvironmentId?.trim() ?? 'client'
  return [
    runtimeEnvironmentId,
    runtimeContext?.connectionId ?? connectionId ?? 'local',
    runtimeContext?.expectedExternalSshTargetId ?? '',
    runtimeContext?.worktreeId ?? 'unknown-worktree',
    absolutePath
  ].join('\0')
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

export { onImageCacheInvalidated }

function isExternalUrl(src: string): boolean {
  return /^(?:https?:\/\/|data:|blob:)/.test(src)
}

/**
 * Resolves a raw markdown image src to a displayable URL. For local images,
 * reads the file via IPC and returns a blob URL. For http/https/data URLs,
 * returns the URL directly. Re-validates on window re-focus so deleted or
 * replaced images are picked up.
 */
export type LocalImageSrcState = {
  src: string | undefined
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'capacity-blocked'
  retry: () => void
}

/** Resolves an image URL and exposes loading, failure, and retry state. */
export function useLocalImageSrcState(
  rawSrc: string | undefined,
  filePath: string,
  connectionId?: string | null,
  runtimeContext?: LocalImageRuntimeContext,
  reloadKey?: string | number
): LocalImageSrcState {
  const [generation, setGeneration] = useState(getLocalImageCacheGeneration())
  const [retryGeneration, setRetryGeneration] = useState(0)
  const activeCacheKeyRef = useRef<string | null>(null)
  const retry = useCallback(() => setRetryGeneration((value) => value + 1), [])

  useEffect(() => {
    if (!rawSrc || isExternalUrl(rawSrc)) {
      return
    }
    const absolutePath = resolveImageAbsolutePath(rawSrc, filePath)
    if (!absolutePath) {
      return
    }
    const cacheKey = getLocalImageCacheKey(absolutePath, connectionId, runtimeContext)
    pinLocalImageBlobUrl(cacheKey)
    return () => unpinLocalImageBlobUrl(cacheKey)
  }, [rawSrc, filePath, connectionId, runtimeContext])

  useEffect(() => {
    return onImageCacheInvalidated(() => setGeneration(getLocalImageCacheGeneration()))
  }, [])

  const [state, setState] = useState<Omit<LocalImageSrcState, 'retry'>>(() => {
    if (!rawSrc) {
      return { src: undefined, status: 'idle' }
    }
    if (isExternalUrl(rawSrc)) {
      return { src: rawSrc, status: 'ready' }
    }
    const absolutePath = resolveImageAbsolutePath(rawSrc, filePath)
    if (absolutePath) {
      const cacheKey = getLocalImageCacheKey(absolutePath, connectionId, runtimeContext)
      const cached = getCachedLocalImageBlobUrl(cacheKey)
      if (cached) {
        activeCacheKeyRef.current = cacheKey
        return { src: cached, status: 'ready' }
      }
    }
    return { src: undefined, status: 'loading' }
  })

  useEffect(() => {
    if (state.status !== 'capacity-blocked') {
      return
    }
    return onLocalImageCacheCapacityAvailable(() => {
      setRetryGeneration((value) => value + 1)
    })
  }, [state.status])

  useEffect(() => {
    if (!rawSrc) {
      activeCacheKeyRef.current = null
      setState({ src: undefined, status: 'idle' })
      return
    }

    if (isExternalUrl(rawSrc)) {
      activeCacheKeyRef.current = rawSrc
      setState({ src: rawSrc, status: 'ready' })
      return
    }

    const absolutePath = resolveImageAbsolutePath(rawSrc, filePath)
    if (!absolutePath) {
      activeCacheKeyRef.current = null
      setState({ src: undefined, status: 'unavailable' })
      return
    }

    const cacheKey = getLocalImageCacheKey(absolutePath, connectionId, runtimeContext)
    const cached = getCachedLocalImageBlobUrl(cacheKey)
    if (cached) {
      activeCacheKeyRef.current = cacheKey
      setState({ src: cached, status: 'ready' })
      return
    }

    let cancelled = false
    const effectGeneration = generation
    const previousCacheKey = activeCacheKeyRef.current
    activeCacheKeyRef.current = cacheKey
    setState((previous) => ({
      src: previousCacheKey === cacheKey ? previous.src : undefined,
      status: 'loading'
    }))
    loadLocalImageAbsolutePathInternal(absolutePath, connectionId, runtimeContext)
      .then((result) => {
        if (cancelled) {
          return
        }
        if (result === LOCAL_IMAGE_CACHE_CAPACITY_BLOCKED) {
          setState({ src: undefined, status: 'capacity-blocked' })
          return
        }
        setState(
          getLocalImageCacheGeneration() === effectGeneration && result
            ? { src: result, status: 'ready' }
            : { src: undefined, status: 'unavailable' }
        )
      })
      .catch(() => {
        if (!cancelled) {
          setState({ src: undefined, status: 'unavailable' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [rawSrc, filePath, generation, connectionId, runtimeContext, reloadKey, retryGeneration])

  return { ...state, retry }
}

export function useLocalImageSrc(
  rawSrc: string | undefined,
  filePath: string,
  connectionId?: string | null,
  runtimeContext?: LocalImageRuntimeContext
): string | undefined {
  return useLocalImageSrcState(rawSrc, filePath, connectionId, runtimeContext).src
}

/**
 * Loads a local image via IPC and returns its blob URL, suitable for use
 * outside React (e.g. ProseMirror nodeViews). Resolves from cache when
 * available.
 */
export async function loadLocalImageSrc(
  rawSrc: string,
  filePath: string,
  connectionId?: string | null,
  runtimeContext?: LocalImageRuntimeContext
): Promise<string | null> {
  if (isExternalUrl(rawSrc)) {
    return rawSrc
  }

  const absolutePath = resolveImageAbsolutePath(rawSrc, filePath)
  if (!absolutePath) {
    return null
  }

  const result = await loadLocalImageAbsolutePathInternal(
    absolutePath,
    connectionId,
    runtimeContext
  )
  return result === LOCAL_IMAGE_CACHE_CAPACITY_BLOCKED ? null : result
}

export function loadLocalImageAbsolutePath(
  absolutePath: string,
  connectionId?: string | null,
  runtimeContext?: LocalImageRuntimeContext
): Promise<string | null> {
  return loadLocalImageAbsolutePathInternal(absolutePath, connectionId, runtimeContext).then(
    (result) => (result === LOCAL_IMAGE_CACHE_CAPACITY_BLOCKED ? null : result)
  )
}

function loadLocalImageAbsolutePathInternal(
  absolutePath: string,
  connectionId?: string | null,
  runtimeContext?: LocalImageRuntimeContext
): Promise<LocalImageLoadResult> {
  const cacheKey = getLocalImageCacheKey(absolutePath, connectionId, runtimeContext)
  const cached = getCachedLocalImageBlobUrl(cacheKey)
  if (cached) {
    return Promise.resolve(cached)
  }

  const inFlight = getInFlightLocalImageLoad(cacheKey)
  if (inFlight) {
    return inFlight
  }

  const reservation = reserveLocalImageCacheSlot(cacheKey)
  if (!reservation) {
    return Promise.resolve(LOCAL_IMAGE_CACHE_CAPACITY_BLOCKED)
  }
  const readGeneration = getLocalImageCacheGeneration()
  const loadPromise = readImagePreview(absolutePath, connectionId, runtimeContext)
    .then((result) => {
      if (
        !result.isBinary ||
        !result.content ||
        getLocalImageCacheGeneration() !== readGeneration
      ) {
        // Why: local image paths must stay behind IPC/runtime authorization;
        // handing raw file: or relative paths back to Chromium can escape it.
        return null
      }
      const url = base64ToBlobUrl(result.content, result.mimeType ?? 'image/png')
      if (getLocalImageCacheGeneration() !== readGeneration) {
        URL.revokeObjectURL(url)
        return null
      }
      cacheLocalImageBlobUrl(cacheKey, url)
      return url
    })
    .catch(() => null)
    .finally(() => {
      deleteInFlightLocalImageLoad(cacheKey, loadPromise)
      releaseLocalImageCacheSlot(cacheKey, reservation)
    })
  setInFlightLocalImageLoad(cacheKey, loadPromise)
  return loadPromise
}

export function resetLocalImageSrcStateForTests(): void {
  resetLocalImageBlobCache()
}

export function invalidateLocalImageSrcCacheForTests(): void {
  invalidateLocalImageCache()
}

function readImagePreview(
  absolutePath: string,
  connectionId?: string | null,
  runtimeContext?: LocalImageRuntimeContext
) {
  try {
    if (!runtimeContext) {
      return window.api.fs.readFile({
        filePath: absolutePath,
        connectionId: connectionId ?? undefined
      })
    }
    return readRuntimeFilePreview(
      {
        ...runtimeContext,
        connectionId: runtimeContext.connectionId ?? connectionId ?? undefined
      },
      absolutePath
    )
  } catch (error) {
    return Promise.reject(error)
  }
}
