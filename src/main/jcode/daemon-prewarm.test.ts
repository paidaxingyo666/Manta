import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnProcessMock } = vi.hoisted(() => ({ spawnProcessMock: vi.fn() }))
vi.mock('../../shared/child-process/run-process', () => ({ spawnProcess: spawnProcessMock }))

import {
  prewarmJcodeDaemon,
  resetJcodeDaemonPrewarmForTests,
  shouldPrewarmJcodeDaemon
} from './daemon-prewarm'

function stubChild() {
  return { unref: vi.fn(), on: vi.fn() }
}

describe('jcode daemon pre-warm', () => {
  beforeEach(() => {
    resetJcodeDaemonPrewarmForTests()
    spawnProcessMock.mockReset()
    spawnProcessMock.mockReturnValue(stubChild())
  })
  afterEach(() => vi.restoreAllMocks())

  it('starts one detached daemon for a jcode pane', () => {
    expect(
      prewarmJcodeDaemon({
        launchAgent: 'jcode',
        runtimeDir: '/tmp/orca-jcode/abc',
        cwd: '/repo',
        platform: 'darwin'
      })
    ).toBe(true)
    expect(spawnProcessMock).toHaveBeenCalledTimes(1)
    const spec = spawnProcessMock.mock.calls[0][0]
    expect(spec.args).toEqual(['--no-update', 'serve'])
    expect(spec.env.JCODE_RUNTIME_DIR).toBe('/tmp/orca-jcode/abc')
    expect(spec.detached).toBe(true)
    // Why stdio ignore: the daemon outlives this spawn, and an inherited pipe
    // would keep Manta attached to a process it does not own.
    expect(spec.stdio).toBe('ignore')
  })

  it('never spawns a daemon for a pane that is not jcode', () => {
    // Why: Manta stamps JCODE_RUNTIME_DIR on every local pane, so gating on the dir
    // alone would start a jcode server behind every plain shell the user opens.
    expect(prewarmJcodeDaemon({ launchAgent: 'claude', runtimeDir: '/tmp/orca-jcode/abc' })).toBe(
      false
    )
    expect(prewarmJcodeDaemon({ runtimeDir: '/tmp/orca-jcode/abc' })).toBe(false)
    expect(spawnProcessMock).not.toHaveBeenCalled()
  })

  it('warms each runtime dir at most once', () => {
    prewarmJcodeDaemon({ launchAgent: 'jcode', runtimeDir: '/tmp/orca-jcode/abc' })
    prewarmJcodeDaemon({ launchAgent: 'jcode', runtimeDir: '/tmp/orca-jcode/abc' })
    prewarmJcodeDaemon({ launchAgent: 'jcode', runtimeDir: '/tmp/orca-jcode/def' })
    expect(spawnProcessMock).toHaveBeenCalledTimes(2)
  })

  it('stays out of the way on Windows, which has no runtime dir', () => {
    expect(
      shouldPrewarmJcodeDaemon({
        launchAgent: 'jcode',
        runtimeDir: 'C:/tmp/orca-jcode/abc',
        platform: 'win32'
      })
    ).toBe(false)
  })

  it('reports failure instead of throwing when the binary is missing', () => {
    spawnProcessMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    // Why fail-open: jcode's client starts its own server when none is listening,
    // so a failed pre-warm costs only the cold start Manta already had.
    expect(prewarmJcodeDaemon({ launchAgent: 'jcode', runtimeDir: '/tmp/orca-jcode/xyz' })).toBe(
      false
    )
  })

  it('retries a runtime dir whose daemon failed to start', () => {
    const child = stubChild()
    spawnProcessMock.mockReturnValue(child)
    prewarmJcodeDaemon({ launchAgent: 'jcode', runtimeDir: '/tmp/orca-jcode/retry' })
    const errorHandler = child.on.mock.calls.find(([event]) => event === 'error')?.[1]
    errorHandler?.(new Error('spawn failed'))
    prewarmJcodeDaemon({ launchAgent: 'jcode', runtimeDir: '/tmp/orca-jcode/retry' })
    expect(spawnProcessMock).toHaveBeenCalledTimes(2)
  })
})
