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
  MantaCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginMantaCloudPkceFlowMock: vi.fn(),
  createMantaCloudProfileMock: vi.fn(),
  exchangeMantaCloudAuthCodeMock: vi.fn(),
  refreshMantaCloudCapabilitiesMock: vi.fn(),
  refreshMantaCloudSessionMock: vi.fn(),
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
  selectMantaCloudOrg: vi.fn()
}))

import {
  connectCurrentMantaProfile,
  createCloudLinkedMantaProfile,
  getCurrentMantaProfileAuthStatus,
  refreshCurrentMantaProfileAuth
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

function mockSuccessfulConnect(expiresAt = futureExpiresAt()): void {
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
    expiresAt,
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies MantaCloudSessionExchangeResponse)
}

describe('Manta cloud profile service session refresh', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'manta-cloud-service-refresh-'))
    beginMantaCloudPkceFlowMock.mockReset()
    createMantaCloudProfileMock.mockReset()
    exchangeMantaCloudAuthCodeMock.mockReset()
    refreshMantaCloudCapabilitiesMock.mockReset()
    refreshMantaCloudSessionMock.mockReset()
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

  it('refreshes an expired access token before creating cloud profiles', async () => {
    configureCloudEnv()
    mockSuccessfulConnect(Date.now() - 1_000)
    await connectCurrentMantaProfile(userDataPath)
    refreshMantaCloudSessionMock.mockResolvedValue({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: cloudSummary,
      organizations,
      capabilities
    } satisfies MantaCloudSessionExchangeResponse)
    createMantaCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities
    } satisfies MantaCloudSessionExchangeResponse)

    const result = await createCloudLinkedMantaProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    expect(result.status).toBe('created')
    expect(refreshMantaCloudSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ refreshToken: 'refresh-token' })
    )
    expect(createMantaCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'rotated-access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('refreshes capability flags for the connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentMantaProfile(userDataPath)
    refreshMantaCloudCapabilitiesMock.mockResolvedValue({
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 25
      }
    })

    const result = await refreshCurrentMantaProfileAuth(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(refreshMantaCloudCapabilitiesMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' })
    )
    expect(getCurrentMantaProfileAuthStatus(userDataPath).capabilities).toEqual({
      flags: { share: false, team: true },
      refreshedAt: 25
    })
  })

  it('clears stale active org metadata when capability refresh returns no active org', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    exchangeMantaCloudAuthCodeMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: futureExpiresAt(),
      cloud: { ...cloudSummary, activeOrgId: 'org-1', activeOrgName: 'Acme' },
      organizations,
      capabilities
    } satisfies MantaCloudSessionExchangeResponse)
    await connectCurrentMantaProfile(userDataPath)
    refreshMantaCloudCapabilitiesMock.mockResolvedValue({
      cloud: cloudSummary,
      organizations: [],
      capabilities: {
        flags: { share: false },
        refreshedAt: 31
      }
    })

    const result = await refreshCurrentMantaProfileAuth(userDataPath)
    const status = getCurrentMantaProfileAuthStatus(userDataPath)

    expect(result.status).toBe('refreshed')
    expect(status.cloud?.activeOrgId).toBeUndefined()
    expect(status.cloud?.activeOrgName).toBeUndefined()
    expect(status.organizations).toEqual([])
    expect(status.capabilities).toEqual({
      flags: { share: false },
      refreshedAt: 31
    })
  })

  it('requires reconnect when an expired refresh token is rejected', async () => {
    configureCloudEnv()
    mockSuccessfulConnect(Date.now() - 1_000)
    await connectCurrentMantaProfile(userDataPath)
    refreshMantaCloudSessionMock.mockRejectedValue(new MantaCloudRequestErrorMock(401))

    const result = await refreshCurrentMantaProfileAuth(userDataPath)

    expect(result.status).toBe('reconnect-required')
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'reconnect-required',
      persistence: 'none',
      cloud: cloudSummary
    })
  })
})
