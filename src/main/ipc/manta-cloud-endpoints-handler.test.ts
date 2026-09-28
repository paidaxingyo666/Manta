import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const relaunchApp = vi.fn()
const quit = vi.fn()

vi.mock('electron', () => ({
  app: { quit: () => quit() },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('../app-relaunch', () => ({ relaunchApp: (reason: string) => relaunchApp(reason) }))
vi.mock('../manta-profiles/profile-cloud-service', () => ({
  signOutCurrentMantaProfile: vi.fn(async () => undefined)
}))
vi.mock('../manta-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/tmp/profile'
}))

const ENDPOINTS = {
  apiBaseUrl: 'https://relay.example.com',
  relayDirectorUrl: 'https://relay.example.com'
}

async function register(flush: () => Promise<void>) {
  const { registerMantaCloudEndpointHandler } = await import('./manta-cloud-endpoints-handler')
  const order: string[] = []
  const store = {
    updateSettings: vi.fn(() => order.push('write')),
    flushPendingOrThrowAsync: vi.fn(async () => {
      order.push('flush')
      await flush()
    })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls updateSettings and the flush.
  registerMantaCloudEndpointHandler(store as never)
  return { store, order, apply: handlers.get('mantaProfiles:applyCloudEndpoints')! }
}

describe('applying self-hosted cloud endpoints', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    handlers.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    relaunchApp.mockReset()
    quit.mockReset()
  })

  it('persists the new endpoints before scheduling the relaunch', async () => {
    const { order, apply } = await register(async () => undefined)
    await expect(apply({}, ENDPOINTS)).resolves.toEqual({ status: 'restarting' })
    expect(order).toEqual(['write', 'flush'])
    vi.advanceTimersByTime(150)
    expect(relaunchApp).toHaveBeenCalledWith('cloud-endpoint-change')
  })

  it('does not relaunch onto the old relay when the write cannot be flushed', async () => {
    const { apply } = await register(async () => {
      throw new Error('disk full')
    })
    await expect(apply({}, ENDPOINTS)).rejects.toThrow('disk full')
    vi.advanceTimersByTime(1000)
    expect(relaunchApp).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })
})
