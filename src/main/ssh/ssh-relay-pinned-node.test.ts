import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NODE_RUNTIME_ASSETS } from '../../shared/node-runtime-pin'
import { remoteInstallVersionDirRegex, RELAY_INSTALL_MODEL } from './remote-install-model'
import type { SshConnection } from './ssh-connection'
import { execCommand } from './ssh-relay-deploy-helpers'
import {
  pinnedNodeRelayFullVersion,
  pinnedRelayAddonFiles,
  pinnedRelayNodePath,
  planPinnedNodeRelay,
  recordPinnedRuntimeRefusal,
  RELAY_RUNTIME_REF_PREFIX,
  resetPinnedRuntimeRefusalsForTests,
  resolveSshRemoteRuntime,
  SSH_REMOTE_RUNTIME_ENV,
  stagePinnedRelayAddons
} from './ssh-relay-pinned-node'
import { getRemoteHostPlatform } from './ssh-remote-platform'

vi.mock('./ssh-relay-deploy-helpers', () => ({ execCommand: vi.fn() }))

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: All connection operations are mocked.
const conn = {} as SshConnection
const SHA = NODE_RUNTIME_ASSETS['linux-x64-glibc'].executableSha256
const directories: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  directories.push(dir)
  return dir
}

function fakeOrcadSlot(target: Parameters<typeof pinnedRelayAddonFiles>[0]): string {
  const dir = tempDir('orcad-slot-')
  for (const file of pinnedRelayAddonFiles(target)) {
    const path = join(dir, ...file.split('/'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `bytes of ${file}`)
  }
  return dir
}

beforeEach(() => {
  vi.mocked(execCommand).mockReset()
  resetPinnedRuntimeRefusalsForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('remote runtime setting', () => {
  it('defaults to legacy, lets the host setting win, and accepts only known env values', () => {
    expect(resolveSshRemoteRuntime(undefined, {})).toBe('legacy')
    expect(resolveSshRemoteRuntime({}, { [SSH_REMOTE_RUNTIME_ENV]: 'pinned-node' })).toBe(
      'pinned-node'
    )
    expect(resolveSshRemoteRuntime({}, { [SSH_REMOTE_RUNTIME_ENV]: 'bun' })).toBe('legacy')
    expect(
      resolveSshRemoteRuntime(
        { remoteRuntime: 'legacy' },
        { [SSH_REMOTE_RUNTIME_ENV]: 'pinned-node' }
      )
    ).toBe('legacy')
  })
})

describe('pinned relay version (D8.1)', () => {
  const base = '0.1.0+abcdef012345'

  it('differs from the host-Node build and stays a valid relay version dir', () => {
    const pinned = pinnedNodeRelayFullVersion(base, SHA, 'addons')
    expect(pinned).not.toBe(base)
    expect(pinned).toMatch(/^0\.1\.0\+[0-9a-f]{12}$/)
    expect(remoteInstallVersionDirRegex(RELAY_INSTALL_MODEL).test(`relay-${pinned}`)).toBe(true)
  })

  it('is stable for the same inputs and changes with the runtime or the addons', () => {
    const pinned = pinnedNodeRelayFullVersion(base, SHA, 'addons')
    expect(pinnedNodeRelayFullVersion(base, SHA, 'addons')).toBe(pinned)
    expect(pinnedNodeRelayFullVersion(base, 'f'.repeat(64), 'addons')).not.toBe(pinned)
    expect(pinnedNodeRelayFullVersion(base, SHA, 'other')).not.toBe(pinned)
    expect(pinnedNodeRelayFullVersion('0.1.0+000000000000', SHA, 'addons')).not.toBe(pinned)
  })

  it('refuses a malformed base version rather than inventing a dir name', () => {
    expect(() => pinnedNodeRelayFullVersion('../x', SHA, 'a')).toThrow('semver')
  })
})

describe('staged addons', () => {
  it('copies the slot addons with a runtime ref, and digests their bytes', async () => {
    const slot = fakeOrcadSlot('darwin-arm64')
    const addons = await stagePinnedRelayAddons(slot, 'darwin-arm64', tempDir('stage-'))
    const sha = NODE_RUNTIME_ASSETS['darwin-arm64'].executableSha256
    expect(readFileSync(join(addons.dir, `${RELAY_RUNTIME_REF_PREFIX}${sha}`), 'utf8').trim()).toBe(
      sha
    )
    expect(existsSync(join(addons.dir, 'node_modules/node-pty/build/Release/pty.node'))).toBe(true)
    expect(existsSync(join(addons.dir, 'node_modules/node-pty/build/Release/spawn-helper'))).toBe(
      true
    )
    expect(existsSync(join(addons.dir, 'node_modules/@parcel/watcher/watcher.node'))).toBe(true)

    writeFileSync(join(slot, 'node_modules/node-pty/build/Release/pty.node'), 'rebuilt')
    const changed = await stagePinnedRelayAddons(slot, 'darwin-arm64', tempDir('stage-'))
    expect(changed.digest).not.toBe(addons.digest)
    await addons.dispose()
    expect(existsSync(addons.dir)).toBe(false)
  })

  it('refuses a slot missing an addon and leaves nothing behind', async () => {
    const slot = fakeOrcadSlot('linux-x64-glibc')
    rmSync(join(slot, 'node_modules/@parcel/watcher/watcher.node'))
    const parent = tempDir('stage-')
    await expect(stagePinnedRelayAddons(slot, 'linux-x64-glibc', parent)).rejects.toThrow(
      'watcher.node'
    )
    expect(readdirSync(parent)).toEqual([])
  })
})

describe('pinned runtime layout', () => {
  it('launches from the shared runtimes store beside the version dirs', () => {
    const host = getRemoteHostPlatform('linux-x64')
    expect(
      pinnedRelayNodePath(host, '/home/u/.manta-remote/relay-0.1.0+abc', 'linux-x64-glibc')
    ).toBe(`/home/u/.manta-remote/runtimes/node-${SHA}/bin/node`)
  })
})

describe('planPinnedNodeRelay', () => {
  const base = '0.1.0+abcdef012345'

  it('keeps Windows hosts on the host-Node relay', async () => {
    await expect(
      planPinnedNodeRelay({
        conn,
        host: getRemoteHostPlatform('win32-x64'),
        baseVersion: base,
        targetId: 't'
      })
    ).resolves.toEqual({ kind: 'host-node', fallbackReason: 'windows_host_unsupported' })
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('refuses a glibc below the pinned Node floor without uploading anything', async () => {
    vi.mocked(execCommand).mockResolvedValueOnce('ldd (GNU libc) 2.17')
    const materializeOrcad = vi.fn()
    await expect(
      planPinnedNodeRelay({
        conn,
        host: getRemoteHostPlatform('linux-x64'),
        baseVersion: base,
        targetId: 't',
        materializeOrcad
      })
    ).resolves.toEqual({ kind: 'host-node', fallbackReason: 'libc_floor' })
    expect(materializeOrcad).not.toHaveBeenCalled()
  })

  it('falls back when the host C library cannot be identified', async () => {
    vi.mocked(execCommand).mockResolvedValue('')
    await expect(
      planPinnedNodeRelay({
        conn,
        host: getRemoteHostPlatform('linux-x64'),
        baseVersion: base,
        targetId: 't'
      })
    ).resolves.toEqual({ kind: 'host-node', fallbackReason: 'target_unresolved' })
  })

  it('does not descend when the libc probe itself is lost', async () => {
    vi.mocked(execCommand).mockRejectedValue(new Error('channel closed'))
    await expect(
      planPinnedNodeRelay({
        conn,
        host: getRemoteHostPlatform('linux-x64'),
        baseVersion: base,
        targetId: 't'
      })
    ).rejects.toThrow('channel closed')
  })

  it('falls back when this client has no mantad slot for the target', async () => {
    vi.mocked(execCommand).mockResolvedValueOnce('ldd (GNU libc) 2.31')
    await expect(
      planPinnedNodeRelay({
        conn,
        host: getRemoteHostPlatform('linux-x64'),
        baseVersion: base,
        targetId: 't',
        materializeOrcad: () => Promise.reject(new Error('template missing'))
      })
    ).resolves.toEqual({ kind: 'host-node', fallbackReason: 'artifacts_unavailable' })
  })

  it('remembers a host refusal for the session', async () => {
    recordPinnedRuntimeRefusal('t', 'linux-x64-glibc', 'noexec')
    vi.mocked(execCommand).mockResolvedValue('ldd (GNU libc) 2.31')
    const materializeOrcad = vi.fn()
    await expect(
      planPinnedNodeRelay({
        conn,
        host: getRemoteHostPlatform('linux-x64'),
        baseVersion: base,
        targetId: 't',
        materializeOrcad
      })
    ).resolves.toEqual({ kind: 'host-node', fallbackReason: 'noexec', remembered: true })
    expect(materializeOrcad).not.toHaveBeenCalled()
  })

  it('plans a pinned relay with a runtime-folded version for a supported host', async () => {
    vi.mocked(execCommand).mockResolvedValueOnce('ldd (GNU libc) 2.28')
    const plan = await planPinnedNodeRelay({
      conn,
      host: getRemoteHostPlatform('linux-x64'),
      baseVersion: base,
      targetId: 't',
      materializeOrcad: async (target) => fakeOrcadSlot(target)
    })
    expect(plan).toMatchObject({
      kind: 'pinned-node',
      target: 'linux-x64-glibc',
      glibc: { major: 2, minor: 28 }
    })
    if (plan.kind === 'pinned-node') {
      expect(plan.fullVersion).toBe(pinnedNodeRelayFullVersion(base, SHA, plan.addons.digest))
      await plan.addons.dispose()
    }
  })
})
