// @vitest-environment happy-dom

import { act, createElement, Fragment, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalImageCacheKey,
  invalidateLocalImageSrcCacheForTests,
  loadLocalImageSrc,
  resetLocalImageSrcStateForTests,
  useLocalImageSrc,
  useLocalImageSrcState
} from './useLocalImageSrc'

type PreviewResult = {
  content: string
  isBinary: boolean
  mimeType?: string
}

function deferred<T>(): {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function binaryPreview(content = 'AA=='): PreviewResult {
  return { content, isBinary: true, mimeType: 'image/png' }
}

function setReadFile(readFile: ReturnType<typeof vi.fn>): void {
  globalThis.window.api = {
    fs: { readFile }
  } as unknown as Window['api']
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function HookProbe({
  filePath,
  onRender,
  src
}: {
  filePath: string
  onRender: (displaySrc: string | undefined) => void
  src: string
}): null {
  onRender(useLocalImageSrc(src, filePath))
  return null
}

function HookList({ indices }: { indices: number[] }): React.JSX.Element {
  return createElement(
    Fragment,
    null,
    indices.map((index) =>
      createElement(HookProbe, {
        key: index,
        filePath: `/repo/image-${index}.png`,
        onRender: () => {},
        src: `/repo/image-${index}.png`
      })
    )
  )
}

function StateHookProbe({
  onRender,
  reloadKey
}: {
  onRender: (state: { src: string | undefined; status: string }) => void
  reloadKey: number
}): null {
  const { src, status } = useLocalImageSrcState(
    '/remote/image.png',
    '/remote/image.png',
    'conn-1',
    undefined,
    reloadKey
  )
  // After commit, not during render: the assertions read the last committed
  // state, and a render-phase callback is what React Doctor forbids.
  useEffect(() => {
    onRender({ src, status })
  })
  return null
}

beforeEach(() => {
  resetLocalImageSrcStateForTests()
  vi.spyOn(URL, 'createObjectURL').mockReset()
  vi.spyOn(URL, 'revokeObjectURL').mockReset()
})

afterEach(() => {
  resetLocalImageSrcStateForTests()
  vi.restoreAllMocks()
})

describe('getLocalImageCacheKey', () => {
  it('scopes local markdown image cache entries by runtime owner', () => {
    const localKey = getLocalImageCacheKey('/repo/docs/logo.png', null, {
      settings: { activeRuntimeEnvironmentId: null },
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })
    const remoteKey = getLocalImageCacheKey('/repo/docs/logo.png', null, {
      settings: { activeRuntimeEnvironmentId: 'env-1' },
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })
    const otherRemoteKey = getLocalImageCacheKey('/repo/docs/logo.png', null, {
      settings: { activeRuntimeEnvironmentId: 'env-2' },
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })

    expect(localKey).not.toBe(remoteKey)
    expect(remoteKey).not.toBe(otherRemoteKey)
  })
})

describe('loadLocalImageSrc', () => {
  it('shares one pending read and one blob URL for duplicate local image loads', async () => {
    const read = deferred<PreviewResult>()
    const readFile = vi.fn().mockReturnValue(read.promise)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-image')
    setReadFile(readFile)

    const first = loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')
    const second = loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')

    expect(readFile).toHaveBeenCalledTimes(1)
    read.resolve(binaryPreview())

    await expect(Promise.all([first, second])).resolves.toEqual([
      'blob:local-image',
      'blob:local-image'
    ])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('admits at most 100 mounted previews and retries after a slot is released', async () => {
    const readFile = vi.fn().mockResolvedValue(binaryPreview())
    let nextUrl = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:image-${++nextUrl}`)
    setReadFile(readFile)

    const container = document.createElement('div')
    const root: Root = createRoot(container)
    await act(async () => {
      root.render(createElement(HookList, { indices: Array.from({ length: 101 }, (_, i) => i) }))
      await flushPromises()
    })

    expect(readFile).toHaveBeenCalledTimes(100)
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:image-1')

    await act(async () => {
      root.render(
        createElement(HookList, { indices: Array.from({ length: 100 }, (_, i) => i + 1) })
      )
      await flushPromises()
      await flushPromises()
    })

    expect(readFile).toHaveBeenCalledTimes(101)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-1')
    await act(async () => root.unmount())
  })

  it('retries a blocked preview when an unmounted in-flight load later frees capacity', async () => {
    const firstRead = deferred<PreviewResult>()
    const readFile = vi.fn(({ filePath }: { filePath: string }) =>
      filePath.endsWith('image-0.png') ? firstRead.promise : Promise.resolve(binaryPreview())
    )
    let nextUrl = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:pending-${++nextUrl}`)
    setReadFile(readFile)
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(createElement(HookList, { indices: Array.from({ length: 101 }, (_, i) => i) }))
      await flushPromises()
    })
    expect(readFile).toHaveBeenCalledTimes(100)

    await act(async () => {
      root.render(
        createElement(HookList, { indices: Array.from({ length: 100 }, (_, i) => i + 1) })
      )
      await flushPromises()
    })
    expect(readFile).toHaveBeenCalledTimes(100)

    await act(async () => {
      firstRead.resolve(binaryPreview())
      await flushPromises()
      await flushPromises()
    })
    expect(readFile).toHaveBeenCalledTimes(101)
    await act(async () => root.unmount())
  })

  it('clears failed in-flight reads so a later retry can succeed', async () => {
    const readFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(binaryPreview())
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:retry')
    setReadFile(readFile)

    await expect(loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')).resolves.toBeNull()
    await expect(loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')).resolves.toBe(
      'blob:retry'
    )
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  it('retries a mounted SSH preview when its connection generation changes', async () => {
    const readFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('disconnected'))
      .mockResolvedValueOnce(binaryPreview())
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reconnected')
    setReadFile(readFile)
    const renders: { src: string | undefined; status: string }[] = []
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(StateHookProbe, { onRender: (state) => renders.push(state), reloadKey: 1 })
      )
      await flushPromises()
    })
    expect(renders.at(-1)).toEqual({ src: undefined, status: 'unavailable' })

    await act(async () => {
      root.render(
        createElement(StateHookProbe, { onRender: (state) => renders.push(state), reloadKey: 2 })
      )
      await flushPromises()
    })
    expect(renders.at(-1)).toEqual({ src: 'blob:reconnected', status: 'ready' })
    expect(readFile).toHaveBeenNthCalledWith(2, {
      filePath: '/remote/image.png',
      connectionId: 'conn-1'
    })
    root.unmount()
  })

  it('does not fall back to raw local src when IPC returns non-binary content', async () => {
    const readFile = vi.fn().mockResolvedValue({
      isBinary: false,
      content: '<svg></svg>',
      mimeType: 'image/svg+xml'
    })
    setReadFile(readFile)

    await expect(loadLocalImageSrc('diagram.svg', '/repo/docs/readme.md')).resolves.toBeNull()
    expect(readFile).toHaveBeenCalledWith({
      filePath: '/repo/docs/diagram.svg',
      connectionId: undefined
    })
  })

  it('does not fall back to raw local src when IPC rejects the read', async () => {
    setReadFile(vi.fn().mockRejectedValue(new Error('denied')))

    await expect(
      loadLocalImageSrc('file:///repo/docs/diagram.png', '/repo/docs/readme.md')
    ).resolves.toBeNull()
  })

  it('suppresses a stale pending completion after cache invalidation', async () => {
    const firstRead = deferred<PreviewResult>()
    const readFile = vi
      .fn()
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce(binaryPreview())
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fresh')
    setReadFile(readFile)

    const staleLoad = loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')
    invalidateLocalImageSrcCacheForTests()
    firstRead.resolve(binaryPreview())

    await expect(staleLoad).resolves.toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    await expect(loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')).resolves.toBe(
      'blob:fresh'
    )
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  it('suppresses a pending completion after the cache is reset', async () => {
    const read = deferred<PreviewResult>()
    setReadFile(vi.fn().mockReturnValue(read.promise))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale-after-reset')

    const staleLoad = loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')
    resetLocalImageSrcStateForTests()
    read.resolve(binaryPreview())

    await expect(staleLoad).resolves.toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('revokes the previous delayed generation on repeated invalidation', async () => {
    setReadFile(vi.fn().mockResolvedValue(binaryPreview()))
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:generation-one')
      .mockReturnValueOnce('blob:generation-two')

    await loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')
    invalidateLocalImageSrcCacheForTests()
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:generation-one')

    await loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')
    invalidateLocalImageSrcCacheForTests()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:generation-one')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:generation-two')
  })

  it('does not let an older invalidated read overwrite a newer successful read', async () => {
    const firstRead = deferred<PreviewResult>()
    const secondRead = deferred<PreviewResult>()
    const readFile = vi
      .fn()
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:newer')
    setReadFile(readFile)

    const staleLoad = loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')
    invalidateLocalImageSrcCacheForTests()
    const newerLoad = loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')

    secondRead.resolve(binaryPreview('AQ=='))
    await expect(newerLoad).resolves.toBe('blob:newer')
    firstRead.resolve(binaryPreview('Ag=='))
    await expect(staleLoad).resolves.toBeNull()
    await expect(loadLocalImageSrc('diagram.png', '/repo/docs/readme.md')).resolves.toBe(
      'blob:newer'
    )
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:newer')
  })

  it('keeps runtime owners in separate image cache entries', async () => {
    const readFile = vi.fn().mockResolvedValue(binaryPreview())
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:runtime-one')
      .mockReturnValueOnce('blob:runtime-two')
    setReadFile(readFile)

    await expect(
      loadLocalImageSrc('diagram.png', '/repo/docs/readme.md', null, {
        settings: { activeRuntimeEnvironmentId: null },
        worktreeId: 'wt-1',
        worktreePath: '/repo',
        connectionId: 'ssh-1'
      })
    ).resolves.toBe('blob:runtime-one')
    await expect(
      loadLocalImageSrc('diagram.png', '/repo/docs/readme.md', null, {
        settings: { activeRuntimeEnvironmentId: null },
        worktreeId: 'wt-2',
        worktreePath: '/repo',
        connectionId: 'ssh-2'
      })
    ).resolves.toBe('blob:runtime-two')
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  it('does not load an external SSH image through a replacement target', async () => {
    const readFile = vi.fn().mockResolvedValue(binaryPreview())
    setReadFile(readFile)

    await expect(
      loadLocalImageSrc('diagram.png', '/tmp/readme.md', null, {
        settings: { activeRuntimeEnvironmentId: null },
        worktreeId: 'wt-1',
        worktreePath: '/repo',
        connectionId: 'ssh-2',
        expectedExternalSshTargetId: 'ssh-1'
      })
    ).resolves.toBeNull()

    expect(readFile).not.toHaveBeenCalled()
  })

  it('does not update mounted hook state after unmount', async () => {
    const read = deferred<PreviewResult>()
    const readFile = vi.fn().mockReturnValue(read.promise)
    const renders: (string | undefined)[] = []
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unmounted')
    setReadFile(readFile)

    const container = document.createElement('div')
    const root: Root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(HookProbe, {
          filePath: '/repo/docs/readme.md',
          onRender: (displaySrc) => renders.push(displaySrc),
          src: 'diagram.png'
        })
      )
    })
    await act(async () => {
      root.unmount()
    })

    read.resolve(binaryPreview())
    await act(async () => {
      await flushPromises()
    })

    expect(renders).toEqual([undefined])
  })
})
