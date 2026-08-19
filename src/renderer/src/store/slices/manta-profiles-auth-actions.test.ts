import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'
import type {
  ConnectCurrentMantaProfileResult,
  CreateCloudLinkedMantaProfileResult,
  MantaProfileAuthStatus,
  MantaProfileListState,
  RefreshCurrentMantaProfileAuthResult,
  SelectMantaProfileOrgResult,
  SignOutCurrentMantaProfileResult
} from '../../../../shared/manta-profiles'

const listState: MantaProfileListState = {
  activeProfileId: 'local-default',
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

const localAuthStatus: MantaProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: false,
  state: 'unconfigured',
  persistence: 'none'
}

const connectedCloud = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  linkedAt: 3
}

const connectedOrganizations = [
  { orgId: 'org-1', name: 'Acme', role: 'Admin' },
  { orgId: 'org-2', name: 'Personal' }
]

const connectedAuthStatus: MantaProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'connected',
  persistence: 'encrypted',
  cloud: connectedCloud,
  organizations: connectedOrganizations,
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

describe('manta profile auth actions slice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mantaProfilesApi.authStatus.mockResolvedValue(localAuthStatus)
    vi.stubGlobal('window', {
      api: {
        mantaProfiles: mantaProfilesApi
      }
    })
  })

  it('connects the current profile and stores returned cloud metadata', async () => {
    const connectedProfiles = [
      {
        ...listState.profiles[0],
        kind: 'cloud-linked' as const,
        cloud: connectedAuthStatus.cloud
      }
    ]
    const result: ConnectCurrentMantaProfileResult = {
      status: 'connected',
      auth: connectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: connectedProfiles
    }
    mantaProfilesApi.connectCurrent.mockResolvedValue(result)
    const store = createTestStore()

    const pending = store.getState().connectCurrentMantaProfile()

    expect(store.getState().mantaProfileConnecting).toBe(true)
    await expect(pending).resolves.toEqual(result)
    expect(store.getState().mantaProfileConnecting).toBe(false)
    expect(store.getState().mantaProfileAuthStatus).toEqual(connectedAuthStatus)
    expect(store.getState().mantaProfiles).toEqual(connectedProfiles)
  })

  it('refreshes current profile auth and stores fresh capability flags', async () => {
    const refreshedAuthStatus: MantaProfileAuthStatus = {
      ...connectedAuthStatus,
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 8
      }
    }
    const result: RefreshCurrentMantaProfileAuthResult = {
      status: 'refreshed',
      auth: refreshedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [
        {
          ...listState.profiles[0],
          kind: 'cloud-linked',
          cloud: refreshedAuthStatus.cloud
        }
      ]
    }
    mantaProfilesApi.refreshAuth.mockResolvedValue(result)
    const store = createTestStore()

    await expect(store.getState().refreshCurrentMantaProfileAuth()).resolves.toEqual(result)
    expect(mantaProfilesApi.refreshAuth).toHaveBeenCalledOnce()
    expect(store.getState().mantaProfileAuthStatus).toEqual(refreshedAuthStatus)
    expect(store.getState().mantaProfiles).toEqual(result.profiles)
  })

  it('creates a cloud-linked profile and stores the returned profile list', async () => {
    const cloudProfile = {
      id: 'cloud-acme',
      name: 'Acme',
      avatar: { kind: 'initials' as const, initials: 'A', color: 'neutral' as const },
      kind: 'cloud-linked' as const,
      createdAt: 5,
      updatedAt: 5,
      lastOpenedAt: 5,
      cloud: {
        ...connectedCloud,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      }
    }
    const result: CreateCloudLinkedMantaProfileResult = {
      status: 'created',
      auth: connectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [...listState.profiles, cloudProfile],
      profile: cloudProfile
    }
    mantaProfilesApi.createCloudLinked.mockResolvedValue(result)
    const store = createTestStore()

    await expect(
      store.getState().createCloudLinkedMantaProfile({ orgId: 'org-1', name: 'Acme' })
    ).resolves.toEqual(result)
    expect(mantaProfilesApi.createCloudLinked).toHaveBeenCalledWith({
      orgId: 'org-1',
      name: 'Acme'
    })
    expect(store.getState().mantaProfiles).toEqual(result.profiles)
  })

  it('signs out the current profile without dropping local profile data', async () => {
    const result: SignOutCurrentMantaProfileResult = {
      status: 'signed-out',
      auth: localAuthStatus,
      activeProfileId: 'local-default',
      profiles: listState.profiles
    }
    mantaProfilesApi.signOutCurrent.mockResolvedValue(result)
    const store = createTestStore()

    await expect(store.getState().signOutCurrentMantaProfile()).resolves.toEqual(result)
    expect(store.getState().mantaProfileAuthStatus).toEqual(localAuthStatus)
    expect(store.getState().mantaProfiles).toEqual(listState.profiles)
  })

  it('selects a cloud organization and refreshes auth state', async () => {
    const selectedAuthStatus: MantaProfileAuthStatus = {
      ...connectedAuthStatus,
      cloud: {
        ...connectedCloud,
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      }
    }
    const result: SelectMantaProfileOrgResult = {
      status: 'selected',
      auth: selectedAuthStatus,
      activeProfileId: 'local-default',
      profiles: [
        {
          ...listState.profiles[0],
          kind: 'cloud-linked',
          cloud: selectedAuthStatus.cloud
        }
      ]
    }
    mantaProfilesApi.selectOrg.mockResolvedValue(result)
    const store = createTestStore()

    await expect(store.getState().selectMantaProfileOrg('org-1')).resolves.toEqual(result)
    expect(mantaProfilesApi.selectOrg).toHaveBeenCalledWith({ orgId: 'org-1' })
    expect(store.getState().mantaProfileAuthStatus).toEqual(selectedAuthStatus)
    expect(store.getState().mantaProfileAuthStatus?.organizations).toEqual(connectedOrganizations)
  })
})
