import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  createCloudLinkedMantaProfileMock,
  connectCurrentMantaProfileMock,
  getCurrentMantaProfileAuthStatusMock,
  refreshCurrentMantaProfileAuthMock,
  selectCurrentMantaProfileOrgMock,
  signOutCurrentMantaProfileMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  createCloudLinkedMantaProfileMock: vi.fn(),
  connectCurrentMantaProfileMock: vi.fn(),
  getCurrentMantaProfileAuthStatusMock: vi.fn(),
  refreshCurrentMantaProfileAuthMock: vi.fn(),
  selectCurrentMantaProfileOrgMock: vi.fn(),
  signOutCurrentMantaProfileMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    relaunch: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../tray/system-tray', () => ({
  destroySystemTray: vi.fn()
}))

vi.mock('../manta-profiles/profile-index-store', () => ({
  createLocalMantaProfile: vi.fn(),
  getMantaProfileListState: vi.fn(),
  seedNewMantaProfileTelemetryConsent: vi.fn(),
  setActiveMantaProfile: vi.fn()
}))

vi.mock('../manta-profiles/profile-project-transfer', () => ({
  transferMantaProfileProject: vi.fn()
}))

vi.mock('../manta-profiles/profile-cloud-service', () => ({
  createCloudLinkedMantaProfile: createCloudLinkedMantaProfileMock,
  connectCurrentMantaProfile: connectCurrentMantaProfileMock,
  getCurrentMantaProfileAuthStatus: getCurrentMantaProfileAuthStatusMock,
  refreshCurrentMantaProfileAuth: refreshCurrentMantaProfileAuthMock,
  selectCurrentMantaProfileOrg: selectCurrentMantaProfileOrgMock,
  signOutCurrentMantaProfile: signOutCurrentMantaProfileMock
}))

import { registerMantaProfileHandlers } from './manta-profiles'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

describe('registerMantaProfileHandlers auth channels', () => {
  beforeEach(() => {
    // Why the port and per-test: userData resolves through AppEnvironment now, and
    // the global setup's beforeEach reinstates its own fake before this runs.
    installFakeAppEnvironment({ getPath: () => '/tmp/manta-user-data' })
    handlers.clear()
    createCloudLinkedMantaProfileMock.mockReset()
    connectCurrentMantaProfileMock.mockReset()
    getCurrentMantaProfileAuthStatusMock.mockReset()
    refreshCurrentMantaProfileAuthMock.mockReset()
    selectCurrentMantaProfileOrgMock.mockReset()
    signOutCurrentMantaProfileMock.mockReset()
  })

  it('returns auth status for the current profile', async () => {
    const status = {
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    }
    getCurrentMantaProfileAuthStatusMock.mockReturnValue(status)
    registerMantaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('mantaProfiles:authStatus')?.(null))).resolves.toBe(
      status
    )
    expect(getCurrentMantaProfileAuthStatusMock).toHaveBeenCalledWith('/tmp/manta-user-data')
  })

  it('connects and signs out the current profile through the cloud service', async () => {
    const connectResult = { status: 'unconfigured', auth: { activeProfileId: 'local-default' } }
    const signOutResult = { status: 'signed-out', auth: { activeProfileId: 'local-default' } }
    connectCurrentMantaProfileMock.mockResolvedValue(connectResult)
    signOutCurrentMantaProfileMock.mockResolvedValue(signOutResult)
    registerMantaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('mantaProfiles:connectCurrent')?.(null))
    ).resolves.toBe(connectResult)
    await expect(
      Promise.resolve(handlers.get('mantaProfiles:signOutCurrent')?.(null))
    ).resolves.toBe(signOutResult)
    expect(connectCurrentMantaProfileMock).toHaveBeenCalledWith('/tmp/manta-user-data')
    expect(signOutCurrentMantaProfileMock).toHaveBeenCalledWith('/tmp/manta-user-data')
  })

  it('refreshes profile auth through the cloud service', async () => {
    const refreshResult = { status: 'refreshed', auth: { activeProfileId: 'local-default' } }
    refreshCurrentMantaProfileAuthMock.mockResolvedValue(refreshResult)
    registerMantaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('mantaProfiles:refreshAuth')?.(null))).resolves.toBe(
      refreshResult
    )
    expect(refreshCurrentMantaProfileAuthMock).toHaveBeenCalledWith('/tmp/manta-user-data')
  })

  it('validates organization selection before calling the cloud service', async () => {
    const selectResult = { status: 'selected', auth: { activeProfileId: 'local-default' } }
    selectCurrentMantaProfileOrgMock.mockResolvedValue(selectResult)
    registerMantaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('mantaProfiles:selectOrg')?.(null, { orgId: ' org-1 ' }))
    ).resolves.toBe(selectResult)
    expect(selectCurrentMantaProfileOrgMock).toHaveBeenCalledWith('/tmp/manta-user-data', 'org-1')

    await expect(
      Promise.resolve(handlers.get('mantaProfiles:selectOrg')?.(null, { orgId: ' ' }))
    ).rejects.toThrow('invalid_manta_profile_org_selection')
  })

  it('creates cloud-linked profiles with trimmed optional args', async () => {
    const createResult = {
      status: 'created',
      auth: { activeProfileId: 'local-default' },
      activeProfileId: 'local-default',
      profiles: [],
      profile: { id: 'cloud-1' }
    }
    createCloudLinkedMantaProfileMock.mockResolvedValue(createResult)
    registerMantaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(
        handlers.get('mantaProfiles:createCloudLinked')?.(null, { orgId: ' org-1 ', name: ' Acme ' })
      )
    ).resolves.toBe(createResult)
    expect(createCloudLinkedMantaProfileMock).toHaveBeenCalledWith('/tmp/manta-user-data', {
      orgId: 'org-1',
      name: 'Acme'
    })
  })
})
