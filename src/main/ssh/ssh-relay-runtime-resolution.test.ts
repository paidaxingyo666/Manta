import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshRemoteRuntimeResolution } from '../../shared/ssh-types'

vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getVersion: () => '1.4.0' })
}))
vi.mock('./ssh-remote-runtime-telemetry', () => ({ trackSshRemoteRuntimeResolved: vi.fn() }))

import {
  RelayRuntimeLadderRun,
  type RelayRuntimeDecisionStore
} from './ssh-relay-runtime-resolution'
import { getRemoteHostPlatform } from './ssh-remote-platform'

const facts = { target: 'linux-x64-glibc' as const, glibc: { major: 2, minor: 31 } }

function memoryStore(): RelayRuntimeDecisionStore & { value?: SshRemoteRuntimeResolution } {
  const store: RelayRuntimeDecisionStore & { value?: SshRemoteRuntimeResolution } = {
    read: () => store.value,
    write: (_id, resolution) => {
      store.value = resolution
    }
  }
  return store
}

function rememberedNoexecRun(store: RelayRuntimeDecisionStore): RelayRuntimeLadderRun {
  const run = new RelayRuntimeLadderRun('ssh-1', store)
  run.host = getRemoteHostPlatform('linux-x64')
  run.facts = facts
  run.refused('A', 'noexec')
  return run
}

describe('RelayRuntimeLadderRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists a rung A refusal and replays it only under a matching key', () => {
    const store = memoryStore()
    rememberedNoexecRun(store).settle('D')
    expect(store.value).toMatchObject({ rung: 'D', pinnedRefusal: 'noexec', glibc: '2.31' })
    const replay = new RelayRuntimeLadderRun('ssh-1', store)
    expect(replay.persistedPinnedRefusal(facts)).toBe('noexec')
    expect(replay.persistedPinnedRefusal({ ...facts, glibc: { major: 2, minor: 35 } })).toBeNull()
  })

  it('drops a remembered noexec once rung C self-tests addons from the same tree', () => {
    const store = memoryStore()
    const run = rememberedNoexecRun(store)
    run.selfTest = 'passed'
    run.settle('C')
    expect(store.value?.rung).toBe('C')
    expect(store.value).not.toHaveProperty('pinnedRefusal')
  })

  it('keeps a remembered noexec when rung C launched warm without a self-test', () => {
    const store = memoryStore()
    rememberedNoexecRun(store).settle('C')
    expect(store.value?.pinnedRefusal).toBe('noexec')
  })
})
