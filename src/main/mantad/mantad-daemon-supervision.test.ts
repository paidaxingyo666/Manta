import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  initDaemonPtyProviderMock,
  disconnectDaemonMock,
  shutdownDaemonMock,
  daemonOwnsFreshPersistentPtysMock,
  readDaemonPidRecordMock
} = vi.hoisted(() => ({
  initDaemonPtyProviderMock: vi.fn<(signal?: unknown, options?: unknown) => Promise<void>>(),
  disconnectDaemonMock: vi.fn<() => Promise<void>>(),
  shutdownDaemonMock: vi.fn<() => Promise<void>>(),
  daemonOwnsFreshPersistentPtysMock: vi.fn<() => boolean>(),
  readDaemonPidRecordMock: vi.fn<() => { pid: number } | null>()
}))

vi.mock('../daemon/daemon-init', () => ({
  initDaemonPtyProvider: initDaemonPtyProviderMock,
  disconnectDaemon: disconnectDaemonMock,
  // Exported here purely so the test can prove it is never reached — killing the daemon on
  // mantad shutdown is what would make an mantad restart destructive again.
  shutdownDaemon: shutdownDaemonMock,
  daemonOwnsFreshPersistentPtys: daemonOwnsFreshPersistentPtysMock,
  readDaemonPidRecord: readDaemonPidRecordMock
}))

const { startMantadDaemon, stopMantadDaemon } = await import('./mantad-daemon-supervision')

beforeEach(() => {
  initDaemonPtyProviderMock.mockResolvedValue()
  disconnectDaemonMock.mockResolvedValue()
  shutdownDaemonMock.mockResolvedValue()
  daemonOwnsFreshPersistentPtysMock.mockReturnValue(true)
  readDaemonPidRecordMock.mockReturnValue({ pid: 4242 })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('startMantadDaemon', () => {
  it('reports live with the daemon pid once the provider is installed', async () => {
    await expect(startMantadDaemon()).resolves.toEqual({ state: 'live', pid: 4242 })
  })

  it('does not arm the macOS login-session death watch', async () => {
    await startMantadDaemon()
    // That watch retires the daemon when the spawning GUI login session dies. An mantad
    // daemon must survive its SSH session ending — arming it would kill every terminal the
    // moment the operator logged out, which is the opposite of the property being bought.
    expect(initDaemonPtyProviderMock).toHaveBeenCalledWith(undefined, {
      macosLoginSessionWatch: false
    })
  })

  it('reports degraded when fresh terminals would fall back to the local provider', async () => {
    daemonOwnsFreshPersistentPtysMock.mockReturnValue(false)
    const result = await startMantadDaemon()
    expect(result.state).toBe('degraded')
  })

  it('fails open when the daemon cannot start at all', async () => {
    initDaemonPtyProviderMock.mockRejectedValue(new Error('node-pty is missing'))
    daemonOwnsFreshPersistentPtysMock.mockReturnValue(false)
    // Fail-open, like the desktop: git, worktrees and non-persistent terminals must still
    // serve. What must not happen is a thrown startup or a claim of persistence.
    await expect(startMantadDaemon()).resolves.toEqual({
      state: 'unavailable',
      reason: 'node-pty is missing'
    })
  })
})

describe('stopMantadDaemon', () => {
  it('disconnects and never shuts the daemon down', async () => {
    await stopMantadDaemon()
    expect(disconnectDaemonMock).toHaveBeenCalledTimes(1)
    // The whole point of item 4: an mantad restart is non-destructive only if the daemon
    // outlives it. shutdownDaemon() kills the daemon and every PTY under it.
    expect(shutdownDaemonMock).not.toHaveBeenCalled()
  })
})
