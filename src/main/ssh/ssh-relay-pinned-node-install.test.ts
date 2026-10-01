import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshConnection } from './ssh-connection'
import { execCommand } from './ssh-relay-deploy-helpers'
import {
  ensureRemoteOrcadNodeRuntime,
  REMOTE_NODE_RUNTIME_MISSING,
  REMOTE_NODE_RUNTIME_READY,
  RemoteNodeRuntimeSelfTestError
} from './mantad-remote-node-runtime'
import { ensurePinnedRelayRuntime, verifyPinnedRelayInstall } from './ssh-relay-pinned-node-install'
import {
  PinnedRelayFallbackError,
  planPinnedNodeRelay,
  resetPinnedRuntimeRefusalsForTests,
  type PinnedRelayPlan
} from './ssh-relay-pinned-node'
import { runPinnedRuntimeSelfTest } from './ssh-relay-runtime-self-test'
import type { HostNodeAddonRelayPlan } from './ssh-relay-host-node-addons'
import { RelayRuntimeLadderRun } from './ssh-relay-runtime-resolution'
import { getRemoteHostPlatform } from './ssh-remote-platform'

vi.mock('./ssh-relay-deploy-helpers', () => ({ execCommand: vi.fn() }))
vi.mock('./mantad-remote-node-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureRemoteOrcadNodeRuntime: vi.fn()
}))
vi.mock('./ssh-relay-runtime-self-test', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runPinnedRuntimeSelfTest: vi.fn()
}))

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: All connection operations are mocked.
const conn = {} as SshConnection
const host = getRemoteHostPlatform('linux-x64')
const plan: PinnedRelayPlan = {
  kind: 'pinned-node',
  target: 'linux-x64-glibc',
  glibc: { major: 2, minor: 31 },
  fullVersion: '0.1.0+feedfacecafe',
  addons: { dir: '/tmp/a', digest: 'd', dispose: async () => {} },
  runtimeArchive: async () => '/tmp/archive.tar.gz'
}
const context = {
  conn,
  host,
  remoteRelayDir: '/home/u/.manta-remote/relay-0.1.0+feedfacecafe',
  plan,
  targetId: 'target-1'
}

beforeEach(() => {
  vi.mocked(execCommand).mockReset()
  vi.mocked(ensureRemoteOrcadNodeRuntime).mockReset().mockResolvedValue({
    executable: '/home/u/.manta-remote/runtimes/node-test/bin/node',
    transfer: 'uploaded'
  })
  vi.mocked(runPinnedRuntimeSelfTest).mockReset()
  resetPinnedRuntimeRefusalsForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('ensurePinnedRelayRuntime', () => {
  it('trusts the verified marker on the warm path and never re-uploads', async () => {
    vi.mocked(execCommand).mockResolvedValueOnce(REMOTE_NODE_RUNTIME_READY)
    await ensurePinnedRelayRuntime(context, true)
    expect(ensureRemoteOrcadNodeRuntime).not.toHaveBeenCalled()
  })

  it('reinstalls a runtime that disappeared from under an installed relay', async () => {
    vi.mocked(execCommand).mockResolvedValueOnce(REMOTE_NODE_RUNTIME_MISSING)
    await ensurePinnedRelayRuntime(context, true)
    expect(ensureRemoteOrcadNodeRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ slotDir: context.remoteRelayDir, target: 'linux-x64-glibc' })
    )
  })

  it('turns a classified runtime refusal into a remembered fallback', async () => {
    vi.mocked(ensureRemoteOrcadNodeRuntime).mockRejectedValueOnce(
      new RemoteNodeRuntimeSelfTestError(126, 'sh: node: Permission denied')
    )
    const failure = await ensurePinnedRelayRuntime(context, false).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PinnedRelayFallbackError)
    expect(failure).toMatchObject({ reason: 'noexec' })

    vi.mocked(execCommand).mockResolvedValueOnce('ldd (GNU libc) 2.31')
    await expect(
      planPinnedNodeRelay({ conn, host, baseVersion: '0.1.0+abc', targetId: 'target-1' })
    ).resolves.toEqual({ kind: 'host-node', fallbackReason: 'noexec', remembered: true })
  })

  it('keeps an unclassified runtime failure as an error, not a step down', async () => {
    const failure = new RemoteNodeRuntimeSelfTestError(1, 'something unexpected')
    vi.mocked(ensureRemoteOrcadNodeRuntime).mockRejectedValueOnce(failure)
    await expect(ensurePinnedRelayRuntime(context, false)).rejects.toBe(failure)
  })
})

describe('verifyPinnedRelayInstall', () => {
  it('passes a verified runtime through', async () => {
    vi.mocked(execCommand).mockResolvedValue('')
    vi.mocked(runPinnedRuntimeSelfTest).mockResolvedValueOnce({
      verdict: 'passed',
      report: {
        ok: true,
        nonce: 'n',
        node: 'v24.21.0',
        napi: '10',
        glibcVersionRuntime: '2.31',
        runtime: 'pinned-node'
      }
    })
    await expect(verifyPinnedRelayInstall(context)).resolves.toBeUndefined()
    expect(runPinnedRuntimeSelfTest).toHaveBeenCalledWith(
      conn,
      context.remoteRelayDir,
      expect.stringMatching(/\/\.manta-remote\/runtimes\/node-[0-9a-f]{64}\/bin\/node$/),
      undefined,
      2,
      { expectPinnedVersion: true }
    )
  })

  it('self-tests rung C on the host Node without the pinned version check or a cached refusal', async () => {
    vi.mocked(execCommand).mockResolvedValue('')
    const run = new RelayRuntimeLadderRun('target-1', null)
    const hostPlan: HostNodeAddonRelayPlan = {
      kind: 'host-node-addons',
      target: 'linux-x64-glibc',
      glibc: { major: 2, minor: 31 },
      fullVersion: '0.1.0+0123456789ab',
      addons: { dir: '/tmp/a', digest: 'd', dispose: async () => {} },
      nodePath: '/opt/node18/bin/node',
      hostNode: { version: { major: 18, minor: 20 }, napi: 9 }
    }
    vi.mocked(runPinnedRuntimeSelfTest).mockResolvedValueOnce({
      verdict: 'refused',
      refusal: 'libc_floor',
      detail: "GLIBC_2.33' not found"
    })
    await expect(
      verifyPinnedRelayInstall({ ...context, plan: hostPlan, run })
    ).rejects.toMatchObject({ reason: 'libc_floor' })
    expect(runPinnedRuntimeSelfTest).toHaveBeenCalledWith(
      conn,
      context.remoteRelayDir,
      '/opt/node18/bin/node',
      undefined,
      2,
      { expectPinnedVersion: false }
    )
    expect(run.selfTest).toBe('refused')
    // A host Node refusal says nothing about Manta's pinned Node on this host.
    vi.mocked(execCommand).mockResolvedValueOnce('ldd (GNU libc) 2.31')
    const next = await planPinnedNodeRelay({
      conn,
      host,
      baseVersion: '0.1.0+abcdef012345',
      targetId: 'target-1',
      materializeOrcad: () => Promise.reject(new Error('stop here'))
    })
    expect(next).toMatchObject({ fallbackReason: 'artifacts_unavailable' })
  })

  it('falls back on a refusal', async () => {
    vi.mocked(runPinnedRuntimeSelfTest).mockResolvedValueOnce({
      verdict: 'refused',
      refusal: 'libc_floor',
      detail: "GLIBC_2.33' not found"
    })
    await expect(verifyPinnedRelayInstall(context)).rejects.toMatchObject({
      reason: 'libc_floor'
    })
  })

  it('never falls back on an unverifiable self-test', async () => {
    vi.mocked(runPinnedRuntimeSelfTest).mockResolvedValueOnce({
      verdict: 'unverifiable',
      detail: 'timed out'
    })
    const failure = await verifyPinnedRelayInstall(context).catch((error: unknown) => error)
    expect(failure).not.toBeInstanceOf(PinnedRelayFallbackError)
    expect(String(failure)).toContain('unverifiable')
  })

  it('rethrows an unconfirmed teardown so the install lock stays held', async () => {
    const lost = Object.assign(new Error('lost'), { sshChannelCloseConfirmed: false })
    vi.mocked(runPinnedRuntimeSelfTest).mockResolvedValueOnce({
      verdict: 'unverifiable',
      detail: 'lost',
      cause: lost
    })
    await expect(verifyPinnedRelayInstall(context)).rejects.toBe(lost)
  })

  it('makes the macOS spawn-helper executable before the self-test', async () => {
    vi.mocked(execCommand).mockResolvedValue('')
    vi.mocked(runPinnedRuntimeSelfTest).mockResolvedValueOnce({ verdict: 'failed', detail: 'x' })
    await verifyPinnedRelayInstall({
      ...context,
      host: getRemoteHostPlatform('darwin-arm64'),
      plan: { ...plan, target: 'darwin-arm64' }
    }).catch(() => {})
    expect(execCommand).toHaveBeenCalledWith(
      conn,
      expect.stringContaining("node_modules/node-pty/build/Release/spawn-helper'"),
      expect.anything()
    )
  })
})
