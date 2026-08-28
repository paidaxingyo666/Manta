import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveMantaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveMantaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/manta-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveMantaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

describe('manta cli worktree awareness', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveMantaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it('lists saved environments even when MANTA_ENVIRONMENT is set', async () => {
    process.env.MANTA_ENVIRONMENT = 'stale-env'
    listEnvironmentsMock.mockReturnValue([addEnvironmentFromPairingCodeMock()])
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['environment', 'list', '--json'], '/tmp/repo')

    expect(listEnvironmentsMock).toHaveBeenCalledWith('/tmp/manta-user-data')
    expect(callMock).not.toHaveBeenCalled()
    expect(logSpy.mock.calls[0]?.[0]).not.toContain('token')
    expect(logSpy.mock.calls[0]?.[0]).not.toContain('publicKeyB64')
  })

  it('adds saved environments even when MANTA_ENVIRONMENT is set', async () => {
    process.env.MANTA_ENVIRONMENT = 'stale-env'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['environment', 'add', '--name', 'desk', '--pairing-code', 'manta://pair#abc', '--json'],
      '/tmp/repo'
    )

    expect(addEnvironmentFromPairingCodeMock).toHaveBeenCalledWith('/tmp/manta-user-data', {
      name: 'desk',
      pairingCode: 'manta://pair#abc'
    })
    expect(callMock).not.toHaveBeenCalled()
    expect(logSpy.mock.calls[0]?.[0]).not.toContain('token')
    expect(logSpy.mock.calls[0]?.[0]).not.toContain('publicKeyB64')
  })
})
