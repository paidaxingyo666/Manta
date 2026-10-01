import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeRuntimeStore from './mantad-remote-node-runtime'

const mocks = vi.hoisted(() => ({
  target: vi.fn(),
  archive: vi.fn(),
  ensure: vi.fn()
}))
vi.mock('./mantad-deployment-target', () => ({ resolveOrcadDeploymentTarget: mocks.target }))
vi.mock('./pinned-runtime-materializer', () => ({
  materializeNodeRuntimeArchive: mocks.archive
}))
vi.mock('./mantad-remote-node-runtime', async (original) => ({
  ...(await original<typeof NodeRuntimeStore>()),
  ensureRemoteOrcadNodeRuntime: mocks.ensure
}))

import { NODE_RUNTIME_ASSETS } from '../../shared/node-runtime-pin'
import type { SshConnection } from './ssh-connection'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { preparePinnedNodeForVault } from './ssh-relay-opencode-pinned-node'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every remote call is mocked; the connection is only passed through.
const conn = {} as SshConnection

function prepare(platform: 'linux-x64' | 'win32-x64', exec: (command: string) => Promise<string>) {
  const relayDir = `${platform === 'win32-x64' ? 'C:/Users/ada' : '/home/ada'}/.manta-remote/relay-build`
  return preparePinnedNodeForVault({
    conn,
    host: getRemoteHostPlatform(platform),
    relayDir,
    cacheRoot: '/cache',
    signal: new AbortController().signal,
    exec,
    remote: (operation) => operation()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pinned Node for the SSH vault reader', () => {
  it.each([
    ['linux-x64', 'linux-x64-glibc', '/home/ada', 'bin/node'],
    ['win32-x64', 'win32-x64', 'C:/Users/ada', 'node.exe']
  ] as const)(
    'installs the official archive into the shared runtimes/ store on %s hosts',
    async (platform, target, home, executableName) => {
      const sha = NODE_RUNTIME_ASSETS[target].executableSha256
      const executable = `${home}/.manta-remote/runtimes/node-${sha}/${executableName}`
      mocks.target.mockResolvedValue(target)
      mocks.ensure.mockImplementation(async (options) => {
        expect(options).toMatchObject({ slotDir: `${home}/.manta-remote/relay-build`, target })
        await options.archivePath()
        return { executable, transfer: 'uploaded' }
      })
      mocks.archive.mockResolvedValue('/cache/node-archive')

      expect(await prepare(platform, vi.fn())).toEqual({ executable, runtimeSha256: sha })
      expect(mocks.archive).toHaveBeenCalledWith(target, '/cache', expect.any(Object))
    }
  )

  it('fetches no archive when the host store already has a verified runtime', async () => {
    mocks.target.mockResolvedValue('win32-x64')
    mocks.ensure.mockResolvedValue({ executable: 'C:/x/node.exe', transfer: 'cached' })
    await prepare('win32-x64', vi.fn())
    expect(mocks.archive).not.toHaveBeenCalled()
  })
})
