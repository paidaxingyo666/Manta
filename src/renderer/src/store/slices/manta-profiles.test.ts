import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createTestStore } from './store-test-helpers'
import type {
  CreateLocalMantaProfileResult,
  MantaProfileAuthStatus,
  MantaProfileListResult,
  TransferMantaProfileProjectResult
} from '../../../../shared/manta-profiles'

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

const listState: MantaProfileListResult = {
  activeProfileId: 'local-default',
  multiProfileUi: false,
  profiles: [
    {
      id: 'local-default',
      name: 'Personal',
      avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
      kind: 'local',
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1
    }
  ]
}

const createdState: CreateLocalMantaProfileResult = {
  activeProfileId: 'local-default',
  profiles: [
    ...listState.profiles,
    {
      id: 'local-work',
      name: 'Work',
      avatar: { kind: 'initials', initials: 'W', color: 'neutral' },
      kind: 'local',
      createdAt: 2,
      updatedAt: 2,
      lastOpenedAt: 2
    }
  ],
  profile: {
    id: 'local-work',
    name: 'Work',
    avatar: { kind: 'initials', initials: 'W', color: 'neutral' },
    kind: 'local',
    createdAt: 2,
    updatedAt: 2,
    lastOpenedAt: 2
  }
}

const localAuthStatus: MantaProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: false,
  state: 'unconfigured',
  persistence: 'none'
}

const connectedAuthStatus: MantaProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'connected',
  persistence: 'encrypted',
  cloud: {
    cloudProfileId: 'cloud-profile-1',
    userId: 'user-1',
    email: 'nina@example.com',
    linkedAt: 3
  },
  capabilities: {
    flags: { share: true },
    refreshedAt: 4
  }
}

const mantaProfilesApi = {
  list: vi.fn(),
  authStatus: vi.fn(),
  createLocal: vi.fn(),
  createCloudLinked: vi.fn(),
  connectCurrent: vi.fn(),
  refreshAuth: vi.fn(),
  signOutCurrent: vi.fn(),
  selectOrg: vi.fn(),
  switchProfile: vi.fn(),
  transferProject: vi.fn()
}

describe('manta profile slice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    toastErrorMock.mockReset()
    mantaProfilesApi.authStatus.mockResolvedValue(localAuthStatus)
    vi.stubGlobal('window', {
      api: {
        mantaProfiles: mantaProfilesApi
      }
    })
  })

  it('fetches profiles into store state', async () => {
    mantaProfilesApi.list.mockResolvedValue(listState)
    const store = createTestStore()

    await store.getState().fetchMantaProfiles()

    expect(store.getState().activeMantaProfileId).toBe('local-default')
    expect(store.getState().mantaProfiles).toEqual(listState.profiles)
    expect(store.getState().mantaProfileAuthStatus).toEqual(localAuthStatus)
    expect(store.getState().mantaProfilesMultiProfileUi).toBe(false)
    expect(store.getState().mantaProfilesLoading).toBe(false)
  })

  it('stores the multi-profile UI flag from the list result', async () => {
    mantaProfilesApi.list.mockResolvedValue({ ...listState, multiProfileUi: true })
    const store = createTestStore()

    await store.getState().fetchMantaProfiles()

    expect(store.getState().mantaProfilesMultiProfileUi).toBe(true)
  })

  it('creates a local profile and returns the created summary', async () => {
    mantaProfilesApi.createLocal.mockResolvedValue(createdState)
    const store = createTestStore()

    const profile = await store.getState().createLocalMantaProfile('Work')

    expect(profile).toEqual(createdState.profile)
    expect(mantaProfilesApi.createLocal).toHaveBeenCalledWith({ name: 'Work' })
    expect(store.getState().mantaProfiles).toEqual(createdState.profiles)
  })

  it('fetches auth status independently', async () => {
    mantaProfilesApi.authStatus.mockResolvedValue(connectedAuthStatus)
    const store = createTestStore()

    await expect(store.getState().fetchMantaProfileAuthStatus()).resolves.toEqual(
      connectedAuthStatus
    )
    expect(store.getState().mantaProfileAuthStatus).toEqual(connectedAuthStatus)
  })

  it('sets switching state while requesting a profile switch', async () => {
    mantaProfilesApi.switchProfile.mockResolvedValue({ status: 'relaunching' })
    const store = createTestStore()
    store.setState({ activeMantaProfileId: 'local-default' })

    const result = await store.getState().switchMantaProfile('local-work')

    expect(result).toEqual({ status: 'relaunching' })
    expect(mantaProfilesApi.switchProfile).toHaveBeenCalledWith({ profileId: 'local-work' })
    expect(store.getState().mantaProfileSwitching).toBe(true)
  })

  it('releases switching state when main reports the profile is already active', async () => {
    // Why: a stale renderer activeMantaProfileId must not lock the switcher
    // forever when no relaunch is actually coming.
    mantaProfilesApi.switchProfile.mockResolvedValue({ status: 'already-active' })
    const store = createTestStore()
    store.setState({ activeMantaProfileId: 'local-default' })

    const result = await store.getState().switchMantaProfile('local-work')

    expect(result).toEqual({ status: 'already-active' })
    expect(store.getState().mantaProfileSwitching).toBe(false)
  })

  it('does not call main when switching to the active profile', async () => {
    const store = createTestStore()
    store.setState({ activeMantaProfileId: 'local-default' })

    const result = await store.getState().switchMantaProfile('local-default')

    expect(result).toEqual({ status: 'already-active' })
    expect(mantaProfilesApi.switchProfile).not.toHaveBeenCalled()
  })

  it('transfers projects through the profile API', async () => {
    const transferResult: TransferMantaProfileProjectResult = {
      status: 'transferred',
      mode: 'copy',
      sourceProfileId: 'local-default',
      targetProfileId: 'local-work',
      sourceRepoId: 'repo-1',
      targetRepoId: 'repo-2',
      targetProjectId: 'repo:repo-2'
    }
    mantaProfilesApi.transferProject.mockResolvedValue(transferResult)
    const store = createTestStore()

    const result = await store.getState().transferMantaProfileProject({
      sourceProfileId: 'local-default',
      targetProfileId: 'local-work',
      repoId: 'repo-1',
      mode: 'copy'
    })

    expect(result).toEqual(transferResult)
    expect(mantaProfilesApi.transferProject).toHaveBeenCalledWith({
      sourceProfileId: 'local-default',
      targetProfileId: 'local-work',
      repoId: 'repo-1',
      mode: 'copy'
    })
  })

  it('marks profile switching when a project transfer relaunches the app', async () => {
    const transferResult: TransferMantaProfileProjectResult = {
      status: 'transferred',
      mode: 'move',
      sourceProfileId: 'local-default',
      targetProfileId: 'local-work',
      sourceRepoId: 'repo-1',
      targetRepoId: 'repo-1',
      targetProjectId: 'repo:repo-1',
      willRelaunch: true
    }
    mantaProfilesApi.transferProject.mockResolvedValue(transferResult)
    const store = createTestStore()

    await store.getState().transferMantaProfileProject({
      sourceProfileId: 'local-default',
      targetProfileId: 'local-work',
      repoId: 'repo-1',
      mode: 'move'
    })

    expect(store.getState().mantaProfileSwitching).toBe(true)
  })

  it('warns when a project already exists in the target profile', async () => {
    const transferResult: TransferMantaProfileProjectResult = {
      status: 'duplicate-target',
      sourceProfileId: 'local-default',
      targetProfileId: 'local-work',
      sourceRepoId: 'repo-1',
      duplicateRepoId: 'repo-existing'
    }
    mantaProfilesApi.transferProject.mockResolvedValue(transferResult)
    const store = createTestStore()

    await store.getState().transferMantaProfileProject({
      sourceProfileId: 'local-default',
      targetProfileId: 'local-work',
      repoId: 'repo-1',
      mode: 'copy'
    })

    expect(toastErrorMock).toHaveBeenCalledWith('Project already exists in that profile')
    expect(store.getState().mantaProfileSwitching).toBe(false)
  })
})
