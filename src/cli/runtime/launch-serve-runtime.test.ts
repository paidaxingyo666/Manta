import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, resolveLocalServeRuntimeMock, serveWithOrcadMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  resolveLocalServeRuntimeMock: vi.fn(),
  serveWithOrcadMock: vi.fn()
}))

vi.mock('child_process', () => ({ spawn: spawnMock, spawnSync: vi.fn() }))
vi.mock('./serve-orcad-launch', () => ({
  resolveLocalServeRuntime: resolveLocalServeRuntimeMock,
  serveWithOrcad: serveWithOrcadMock
}))

import { serveMantaApp } from './launch'

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  kill = vi.fn()
  unref = vi.fn()
  pid = 4101
}

/** Electron serve that exits cleanly once spawned, whenever selection gets to spawning it. */
function electronChild(): void {
  spawnMock.mockImplementation(() => {
    const child = new FakeChildProcess()
    setTimeout(() => child.emit('exit', 0, null), 0)
    return child
  })
}

describe('manta serve host selection', () => {
  let stderr: string[]

  beforeEach(() => {
    spawnMock.mockReset()
    resolveLocalServeRuntimeMock.mockReset()
    serveWithOrcadMock.mockReset()
    process.env.MANTA_APP_EXECUTABLE = '/opt/manta/manta-ide'
    stderr = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.MANTA_APP_EXECUTABLE
    delete process.env.ORCA_SERVE_RUNTIME
  })

  it('serves on mantad by default', async () => {
    const selection = { kind: 'mantad', runtime: '/node', entry: '/slot/mantad.js', version: '1' }
    resolveLocalServeRuntimeMock.mockResolvedValue(selection)
    serveWithOrcadMock.mockResolvedValue(0)

    await expect(serveMantaApp({ json: true })).resolves.toBe(0)
    expect(serveWithOrcadMock).toHaveBeenCalledWith(
      selection,
      { json: true },
      expect.any(String),
      expect.not.objectContaining({ ELECTRON_RUN_AS_NODE: expect.anything() })
    )
    expect(spawnMock).not.toHaveBeenCalled()
    expect(stderr.join('')).toContain('[serve] running on mantad 1')
  })

  it('falls back to Electron and prints why when mantad cannot serve', async () => {
    resolveLocalServeRuntimeMock.mockResolvedValue({ kind: 'electron', reason: 'no template' })
    electronChild()

    await expect(serveMantaApp({ json: true })).resolves.toBe(0)
    expect(spawnMock).toHaveBeenCalledWith(
      '/opt/manta/manta-ide',
      expect.arrayContaining(['--serve', '--serve-json']),
      expect.any(Object)
    )
    expect(stderr.join('')).toContain('[serve] using Electron serve: no template')
  })

  it('keeps Electron without asking mantad when ORCA_SERVE_RUNTIME=electron', async () => {
    process.env.ORCA_SERVE_RUNTIME = 'electron'
    electronChild()

    await expect(serveMantaApp({ json: true })).resolves.toBe(0)
    expect(resolveLocalServeRuntimeMock).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalledOnce()
    expect(stderr.join('')).not.toContain('[serve]')
  })
})
