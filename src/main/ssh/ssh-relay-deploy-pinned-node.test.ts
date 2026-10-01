import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RelayRipgrepInstallModule from './ssh-relay-ripgrep-install'

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock/app' }
}))

// Why: deployAndLaunchRelay now reads `${localRelayDir}/.version` upfront
// (per docs/ssh-relay-versioned-install-dirs.md). The fs mock must report
// the local relay package as existing AND return a content-hashed version
// string so readLocalFullVersion succeeds.
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('0.1.0+abcdef012345')
}))

vi.mock('./relay-protocol', () => ({
  RELAY_VERSION: '0.1.0',
  RELAY_REMOTE_DIR: '.manta-remote',
  parseUnameToRelayPlatform: vi.fn((os: string, arch: string) => {
    const normalizedOs = os.toLowerCase()
    const normalizedArch = arch.toLowerCase()
    const relayArch = normalizedArch === 'arm64' || normalizedArch === 'aarch64' ? 'arm64' : 'x64'
    if (normalizedOs === 'windows' || normalizedOs === 'win32') {
      return `win32-${relayArch}`
    }
    if (normalizedOs === 'darwin') {
      return `darwin-${relayArch}`
    }
    if (normalizedOs === 'linux') {
      return `linux-${relayArch}`
    }
    return null
  }),
  RELAY_SENTINEL: 'MANTA-RELAY v0.1.0 READY\n',
  RELAY_SENTINEL_TIMEOUT_MS: 10_000
}))

vi.mock('./ssh-relay-deploy-helpers', () => ({
  uploadDirectory: vi.fn().mockResolvedValue(undefined),
  waitForSentinel: vi.fn().mockResolvedValue({
    write: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn()
  }),
  isUnconfirmedSshCommandTermination: (error: unknown) =>
    error instanceof Error &&
    'sshChannelCloseConfirmed' in error &&
    error.sshChannelCloseConfirmed === false,
  execCommand: vi.fn().mockResolvedValue('__MANTA_REMOTE_PLATFORM__ Linux x86_64')
}))

vi.mock('./ssh-remote-node-resolution', () => ({
  resolveRemoteNodePath: vi.fn().mockResolvedValue('/usr/bin/node')
}))

// Why: this file mocks fs, so the real content hash cannot read a binary.
vi.mock('../ripgrep/bundled-ripgrep-path', () => ({
  resolveBundledRipgrepPath: () => null,
  bundledRipgrepContentKey: () => 'c0ffee0123456789'
}))

// Why: the fire-and-forget ripgrep install would drain the queued exec mocks.
// Why: the post-launch ripgrep cache GC is fire-and-forget and would drain the queued exec mocks.
vi.mock('./ssh-relay-ripgrep-cache-gc', () => ({ gcRemoteRipgrepCache: vi.fn() }))
vi.mock('./ssh-relay-opencode-runtime', () => ({
  ensureRemoteOpenCodeRuntime: vi.fn().mockResolvedValue('ready')
}))
vi.mock('./ssh-relay-ripgrep-install', async (importOriginal) => ({
  ...(await importOriginal<typeof RelayRipgrepInstallModule>()),
  ensureRemoteBundledRipgrep: vi.fn().mockResolvedValue('present'),
  recordRemoteRipgrepReference: vi.fn().mockResolvedValue(true)
}))

// Why: the versioned-install modules shell out for install state, locking,
// and GC. Stub them so deploy tests need no real SSH connection.
vi.mock('./ssh-relay-versioned-install', () => ({
  readLocalFullVersion: vi.fn().mockReturnValue('0.1.0+abcdef012345'),
  computeRemoteRelayDir: (home: string, v: string) => `${home}/.manta-remote/relay-${v}`,
  isRelayAlreadyInstalled: vi.fn().mockResolvedValue(true),
  finalizeInstall: vi.fn().mockResolvedValue(undefined),
  abandonInstall: vi.fn().mockResolvedValue(undefined),
  gcOldRelayVersions: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./ssh-relay-install-lock', () => ({
  acquireInstallLock: vi.fn().mockResolvedValue(undefined),
  RELAY_INSTALL_LOCK_NAME: '.install-lock'
}))

vi.mock('./ssh-relay-repair-lock', () => ({
  tryAcquireRelayRepairLock: vi.fn().mockResolvedValue('acquired')
}))

vi.mock('./ssh-connection-utils', () => ({
  shellEscape: (s: string) => `'${s}'`,
  createSshOperationAbortError: () =>
    Object.assign(new Error('SSH operation was cancelled'), {
      name: 'AbortError'
    })
}))

vi.mock('./ssh-relay-pinned-node', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  planPinnedNodeRelay: vi.fn()
}))

vi.mock('./ssh-relay-pinned-node-install', () => ({
  ensurePinnedRelayRuntime: vi.fn().mockResolvedValue(undefined),
  verifyPinnedRelayInstall: vi.fn().mockResolvedValue(undefined)
}))

import { deployAndLaunchRelay } from './ssh-relay-deploy'
import { execCommand } from './ssh-relay-deploy-helpers'
import { resolveRemoteNodePath } from './ssh-remote-node-resolution'
import { finalizeInstall, isRelayAlreadyInstalled } from './ssh-relay-versioned-install'
import {
  PinnedRelayFallbackError,
  planPinnedNodeRelay,
  type PinnedRelayPlan
} from './ssh-relay-pinned-node'
import { ensurePinnedRelayRuntime, verifyPinnedRelayInstall } from './ssh-relay-pinned-node-install'
import type { SshConnection } from './ssh-connection'
import { NODE_RUNTIME_ASSETS } from '../../shared/node-runtime-pin'
import type { SshRemoteRuntime } from '../../shared/ssh-types'

const PINNED_VERSION = '0.1.0+feedfacecafe'
const RUNTIME_SHA = NODE_RUNTIME_ASSETS['linux-x64-glibc'].executableSha256
const PINNED_NODE = `/home/user/.manta-remote/runtimes/node-${RUNTIME_SHA}/bin/node`

function pinnedPlan(): PinnedRelayPlan {
  return {
    kind: 'pinned-node',
    target: 'linux-x64-glibc',
    glibc: { major: 2, minor: 31 },
    fullVersion: PINNED_VERSION,
    addons: { dir: '/tmp/addons', digest: 'd', dispose: vi.fn().mockResolvedValue(undefined) },
    runtimeArchive: vi.fn()
  }
}

function makeConnection(remoteRuntime?: SshRemoteRuntime): SshConnection {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the deploy path under test touches only these members of the connection.
  return {
    canRunConcurrentExecCommands: vi.fn().mockReturnValue(true),
    getTarget: () => ({ id: 'target-1', ...(remoteRuntime ? { remoteRuntime } : {}) }),
    exec: vi.fn().mockResolvedValue({
      on: vi.fn(),
      stderr: { on: vi.fn() },
      stdin: {},
      stdout: { on: vi.fn() },
      close: vi.fn()
    })
  } as unknown as SshConnection
}

function detachedLaunchCommand(conn: SshConnection): string | undefined {
  return vi
    .mocked(conn.exec)
    .mock.calls.map(([cmd]) => String(cmd))
    .find((cmd) => cmd.includes('--detached'))
}

function queueInstalledPinnedLaunch(): void {
  vi.mocked(execCommand)
    .mockResolvedValueOnce('__MANTA_REMOTE_PLATFORM__ Linux x86_64')
    .mockResolvedValueOnce('/home/user')
    .mockResolvedValueOnce('') // launch namespace marker
    .mockResolvedValueOnce('DEAD')
    .mockResolvedValueOnce('READY')
}

function queueInstalledLegacyLaunch(): void {
  vi.mocked(execCommand)
    .mockResolvedValueOnce('__MANTA_REMOTE_PLATFORM__ Linux x86_64')
    .mockResolvedValueOnce('/home/user')
    .mockResolvedValueOnce('MANTA-NATIVE-DEPS-OK')
    .mockResolvedValueOnce('') // launch namespace marker
    .mockResolvedValueOnce('DEAD')
    .mockResolvedValueOnce('READY')
}

describe('deployAndLaunchRelay on the pinned Node runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(execCommand).mockReset().mockResolvedValue('')
    vi.mocked(resolveRemoteNodePath).mockReset().mockResolvedValue('/usr/bin/node')
    vi.mocked(isRelayAlreadyInstalled).mockReset().mockResolvedValue(true)
    vi.mocked(planPinnedNodeRelay).mockReset().mockResolvedValue(pinnedPlan())
    vi.mocked(ensurePinnedRelayRuntime).mockReset().mockResolvedValue(undefined)
  })

  it('keeps the legacy host-Node path when the host has no runtime setting', async () => {
    const conn = makeConnection()
    queueInstalledLegacyLaunch()

    const result = await deployAndLaunchRelay(conn, undefined, undefined, 'target-1')

    expect(planPinnedNodeRelay).not.toHaveBeenCalled()
    expect(result.nodePath).toBe('/usr/bin/node')
    expect(result.serverBuildId).toBe('0.1.0+abcdef012345')
  })

  it('launches from the runtime-folded version dir with the pinned Node and no host Node probe', async () => {
    const conn = makeConnection('pinned-node')
    queueInstalledPinnedLaunch()

    const result = await deployAndLaunchRelay(conn, undefined, undefined, 'target-1')

    expect(resolveRemoteNodePath).not.toHaveBeenCalled()
    expect(result.serverBuildId).toBe(PINNED_VERSION)
    expect(result.remoteRelayDir).toBe(`/home/user/.manta-remote/relay-${PINNED_VERSION}`)
    expect(result.nodePath).toBe(PINNED_NODE)
    expect(detachedLaunchCommand(conn)).toContain(`'${PINNED_NODE}' relay.js --detached`)
    expect(
      vi.mocked(execCommand).mock.calls.some(([, cmd]) => String(cmd).includes('NATIVE-DEPS'))
    ).toBe(false)
  })

  it('falls back to the host-Node relay on a classified refusal', async () => {
    const conn = makeConnection('pinned-node')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(ensurePinnedRelayRuntime).mockRejectedValueOnce(
      new PinnedRelayFallbackError('noexec', 'exit 126: Permission denied')
    )
    vi.mocked(execCommand)
      .mockResolvedValueOnce('__MANTA_REMOTE_PLATFORM__ Linux x86_64')
      .mockResolvedValueOnce('/home/user')
    queueInstalledLegacyLaunch()

    const result = await deployAndLaunchRelay(conn, undefined, undefined, 'target-1')

    expect(result.nodePath).toBe('/usr/bin/node')
    expect(result.serverBuildId).toBe('0.1.0+abcdef012345')
    expect(detachedLaunchCommand(conn)).toContain("'/usr/bin/node' relay.js --detached")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('(noexec)'))
    warn.mockRestore()
  })

  it('does not step down when the runtime check is unverifiable', async () => {
    const conn = makeConnection('pinned-node')
    const unverifiable = new Error('The pinned Node self-test is unverifiable')
    vi.mocked(ensurePinnedRelayRuntime).mockRejectedValueOnce(unverifiable)
    vi.mocked(execCommand)
      .mockResolvedValueOnce('__MANTA_REMOTE_PLATFORM__ Linux x86_64')
      .mockResolvedValueOnce('/home/user')

    await expect(deployAndLaunchRelay(conn, undefined, undefined, 'target-1')).rejects.toBe(
      unverifiable
    )
    expect(resolveRemoteNodePath).not.toHaveBeenCalled()
    expect(detachedLaunchCommand(conn)).toBeUndefined()
  })

  it('releases the staged addons after the attempt', async () => {
    const conn = makeConnection('pinned-node')
    const plan = pinnedPlan()
    vi.mocked(planPinnedNodeRelay).mockResolvedValueOnce(plan)
    queueInstalledPinnedLaunch()

    await deployAndLaunchRelay(conn, undefined, undefined, 'target-1')

    expect(plan.addons.dispose).toHaveBeenCalledOnce()
  })

  it('uploads the relay and its addons, then self-tests instead of installing native deps', async () => {
    const conn = makeConnection('pinned-node')
    const uploadDirectory = vi.fn().mockResolvedValue(undefined)
    Object.assign(conn, { uploadDirectory, writeFile: vi.fn().mockResolvedValue(undefined) })
    vi.mocked(isRelayAlreadyInstalled).mockReset().mockResolvedValue(false)
    vi.mocked(execCommand).mockImplementation((_conn, command) => {
      const marker = command.match(/\.sftp-namespace-[0-9a-f]{32}/u)?.[0]
      if (command.includes('uname')) {
        return Promise.resolve('__MANTA_REMOTE_PLATFORM__ Linux x86_64')
      }
      if (command === 'echo $HOME') {
        return Promise.resolve('/home/user')
      }
      if (command.includes('__MANTA_UPLOAD_STAGE_SLOT__') && marker) {
        return Promise.resolve(`__MANTA_UPLOAD_STAGE_SLOT__${marker}:slot-0`)
      }
      if (command.includes('__MANTA_UPLOAD_STAGE_PROMOTION__') && marker) {
        return Promise.resolve(`__MANTA_UPLOAD_STAGE_PROMOTION__${marker}:PROMOTED`)
      }
      if (command.includes('process.stdout.write("READY")')) {
        return Promise.resolve('READY')
      }
      return Promise.resolve(command.includes('test -S') ? 'DEAD' : '')
    })

    await deployAndLaunchRelay(conn, undefined, undefined, 'target-1')

    expect(uploadDirectory.mock.calls.map(([local]) => local)).toContain('/tmp/addons')
    expect(ensurePinnedRelayRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteRelayDir: `/home/user/.manta-remote/relay-${PINNED_VERSION}`
      }),
      false
    )
    expect(verifyPinnedRelayInstall).toHaveBeenCalledOnce()
    expect(vi.mocked(verifyPinnedRelayInstall).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(finalizeInstall).mock.invocationCallOrder[0]
    )
    expect(
      vi.mocked(execCommand).mock.calls.some(([, cmd]) => /npm (?:install|ci)/.test(String(cmd)))
    ).toBe(false)
    expect(detachedLaunchCommand(conn)).toContain(`'${PINNED_NODE}' relay.js --detached`)
  })
})
