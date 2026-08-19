import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '../../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'
import { createTestStore } from './store-test-helpers'

const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  runtimeEnvironmentCall.mockReset()
  runtimeEnvironmentTransportCall.mockReset()
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    api: {
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall }
    }
  })
})

describe('repo slice runtime project groups', () => {
  it('keeps runtime copies of a grouped canonical project in the same project group', async () => {
    const gitRemoteIdentity = {
      canonicalKey: 'github.com/stablyai/manta',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/stablyai/manta.git'
    }
    const localManta: Repo = {
      id: 'local-manta',
      path: '/Users/alice/stably/manta',
      displayName: 'manta',
      badgeColor: '#000',
      addedAt: 1,
      executionHostId: 'local',
      gitRemoteIdentity,
      projectGroupId: 'group-manta'
    }
    const runtimeManta: Repo = {
      id: 'runtime-manta',
      path: '/vercel/sandbox/manta',
      displayName: 'manta',
      badgeColor: '#111',
      addedAt: 2,
      gitRemoteIdentity
    }
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-runtime-manta',
      ok: true,
      result: { repos: [runtimeManta] },
      _meta: { runtimeId: 'runtime-remote' }
    })
    const store = createTestStore()
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-1' } as never,
      repos: [localManta]
    })

    await store.getState().fetchRepos()

    expect(store.getState().repos).toEqual([
      localManta,
      {
        ...runtimeManta,
        executionHostId: 'runtime:env-1',
        projectGroupId: 'group-manta'
      }
    ])
  })
})
