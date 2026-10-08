import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ssh-relay-deploy-helpers', () => ({
  execCommand: vi.fn(),
  isUnconfirmedSshCommandTermination: (error: unknown) =>
    error instanceof Error && error.message === 'unconfirmed'
}))

import { execCommand } from './ssh-relay-deploy-helpers'
import { launchOrcadAndAwaitReadiness } from './mantad-remote-runtime-control'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import type { OrcadLaunchSpec } from './mantad-remote-launch'

const host = getRemoteHostPlatform('linux-arm64')
const spec: OrcadLaunchSpec = {
  remoteInstallDir: '/root/.manta-remote/mantad-0.1.0+07d0995735e0',
  nodePath: '/usr/bin/node',
  fullVersion: '0.1.0+07d0995735e0',
  userDataDir: '/root/.manta',
  bindHost: '127.0.0.1',
  port: 6768,
  activationRoot: '/root/.manta-remote/.mantad-activation-transaction'
}
const READY = `${JSON.stringify({ type: 'manta_server_ready', runtimeId: 'r1' })}\n`
const mockExec = vi.mocked(execCommand)

function launch() {
  return launchOrcadAndAwaitReadiness(
    { conn: Object.create(null), host, readinessTimeoutMs: 60_000, sleep: async () => {} },
    spec
  )
}

describe('waiting for a launched candidate', () => {
  beforeEach(() => {
    mockExec.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  // BUG-17: one failed read of the readiness file failed the launch, and the activation then
  // stopped a candidate that went ready a moment later.
  it('retries a failed readiness read instead of failing the launch', async () => {
    mockExec
      .mockResolvedValueOnce('1786\n')
      .mockRejectedValueOnce(new Error('(SSH) Channel open failure: open failed'))
      .mockResolvedValueOnce(READY)
    await expect(launch()).resolves.toMatchObject({
      state: 'ready',
      readiness: { runtimeId: 'r1' }
    })
  })

  it('still fails at once on an unconfirmed termination, which may have run remotely', async () => {
    mockExec.mockResolvedValueOnce('1786\n').mockRejectedValueOnce(new Error('unconfirmed'))
    await expect(launch()).rejects.toThrow('unconfirmed')
  })
})
