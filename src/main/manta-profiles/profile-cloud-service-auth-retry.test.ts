import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  MantaCloudCapabilities,
  MantaCloudOrgSummary,
  MantaProfileCloudSummary
} from '../../shared/manta-profiles'
import type { MantaCloudSessionExchangeResponse } from './profile-cloud-session-exchange'

const {
  beginMantaCloudPkceFlowMock,
  createMantaCloudProfileMock,
  exchangeMantaCloudAuthCodeMock,
  refreshMantaCloudCapabilitiesMock,
  refreshMantaCloudSessionMock,
  selectMantaCloudOrgMock,
  MantaCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginMantaCloudPkceFlowMock: vi.fn(),
  createMantaCloudProfileMock: vi.fn(),
  exchangeMantaCloudAuthCodeMock: vi.fn(),
  refreshMantaCloudCapabilitiesMock: vi.fn(),
  refreshMantaCloudSessionMock: vi.fn(),
  selectMantaCloudOrgMock: vi.fn(),
  MantaCloudRequestErrorMock: class MantaCloudRequestError extends Error {
    constructor(public readonly statusCode: number) {
      super(`manta_cloud_request_failed_${statusCode}`)
      this.name = 'MantaCloudRequestError'
    }
  },
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  },
  safeStorage: safeStorageMock
}))

vi.mock('./profile-cloud-pkce', () => ({
  beginMantaCloudPkceFlow: beginMantaCloudPkceFlowMock
}))

vi.mock('./profile-cloud-client', () => ({
  MantaCloudRequestError: MantaCloudRequestErrorMock,
  createMantaCloudProfile: createMantaCloudProfileMock,
  exchangeMantaCloudAuthCode: exchangeMantaCloudAuthCodeMock,
  refreshMantaCloudCapabilities: refreshMantaCloudCapabilitiesMock,
  refreshMantaCloudSession: refreshMantaCloudSessionMock,
  revokeMantaCloudSession: vi.fn(),
  selectMantaCloudOrg: selectMantaCloudOrgMock
}))

import {
  connectCurrentMantaProfile,
  createCloudLinkedMantaProfile,
  getCurrentMantaProfileAuthStatus,
  refreshCurrentMantaProfileAuth,
  selectCurrentMantaProfileOrg
} from './profile-cloud-service'

const cloudSummary: MantaProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const capabilities: MantaCloudCapabilities = {
  flags: { share: true },
  refreshedAt: 11
}

const organizations: MantaCloudOrgSummary[] = [
  { orgId: 'org-1', name: 'Acme', role: 'Admin' },
  { orgId: 'org-2', name: 'Personal' }
]

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function configureCloudEnv(): void {
  vi.stubEnv('MANTA_CLOUD_API_URL', 'https://manta-cloud.example')
  vi.stubEnv('MANTA_CLOUD_CLIENT_ID', 'desktop-client')
}

function mockSuccessfulConnect(): void {
  beginMantaCloudPkceFlowMock.mockResolvedValue({
    code: 'auth-code',
    codeVerifier: 'code-verifier',
    nonce: 'nonce',
    redirectUri: 'http://127.0.0.1:4100/auth/callback',
    state: 'state'
  })
  exchangeMantaCloudAuthCodeMock.mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies MantaCloudSessionExchangeResponse)
}

function mockSuccessfulSessionRefresh(): void {
  refreshMantaCloudSessionMock.mockResolvedValue({
    accessToken: 'rotated-access-token',
    refreshToken: 'rotated-refresh-token',
    expiresAt: futureExpiresAt(),
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies MantaCloudSessionExchangeResponse)
}

describe('Manta cloud profile auth-failure retry', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'manta-cloud-service-auth-retry-'))
    beginMantaCloudPkceFlowMock.mockReset()
    createMantaCloudProfileMock.mockReset()
    exchangeMantaCloudAuthCodeMock.mockReset()
    refreshMantaCloudCapabilitiesMock.mockReset()
    refreshMantaCloudSessionMock.mockReset()
    selectMantaCloudOrgMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('MANTA_CLOUD_API_URL', '')
    vi.stubEnv('MANTA_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('refreshes and retries cloud profile creation after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentMantaProfile(userDataPath)
    createMantaCloudProfileMock
      .mockRejectedValueOnce(new MantaCloudRequestErrorMock(401))
      .mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: futureExpiresAt(),
        cloud: { ...cloudSummary, cloudProfileId: 'cloud-profile-2' },
        organizations,
        capabilities
      } satisfies MantaCloudSessionExchangeResponse)

    const result = await createCloudLinkedMantaProfile(userDataPath, { name: 'Acme' })

    expect(result.status).toBe('created')
    expect(createMantaCloudProfileMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { name: 'Acme' }
    )
  })

  it('refreshes and retries capability refresh after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentMantaProfile(userDataPath)
    refreshMantaCloudCapabilitiesMock
      .mockRejectedValueOnce(new MantaCloudRequestErrorMock(403))
      .mockResolvedValue({
        capabilities: { flags: { share: false }, refreshedAt: 26 } satisfies MantaCloudCapabilities
      })

    const result = await refreshCurrentMantaProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshMantaCloudCapabilitiesMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' })
    )
    expect(getCurrentMantaProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 26
    })
  })

  it('requires reconnect when a retried capability refresh is still unauthorized', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentMantaProfile(userDataPath)
    refreshMantaCloudCapabilitiesMock
      .mockRejectedValueOnce(new MantaCloudRequestErrorMock(401))
      .mockRejectedValueOnce(new MantaCloudRequestErrorMock(401))

    const result = await refreshCurrentMantaProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })

  it('refreshes and retries organization selection after an auth failure', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    mockSuccessfulSessionRefresh()
    await connectCurrentMantaProfile(userDataPath)
    selectMantaCloudOrgMock
      .mockRejectedValueOnce(new MantaCloudRequestErrorMock(401))
      .mockResolvedValue({
        cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
        organizations,
        capabilities
      })

    const result = await selectCurrentMantaProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectMantaCloudOrgMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      'org-1'
    )
  })
})
