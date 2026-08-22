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
import type { MantaCloudRequestError as MantaCloudRequestErrorType } from './profile-cloud-client'

type ProfileCloudClientModule = { MantaCloudRequestError: typeof MantaCloudRequestErrorType }

const {
  beginMantaCloudPkceFlowMock,
  createMantaCloudProfileMock,
  exchangeMantaCloudAuthCodeMock,
  grantMantaCloudSessionDirectlyMock,
  revokeMantaCloudSessionMock,
  selectMantaCloudOrgMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginMantaCloudPkceFlowMock: vi.fn(),
  createMantaCloudProfileMock: vi.fn(),
  exchangeMantaCloudAuthCodeMock: vi.fn(),
  grantMantaCloudSessionDirectlyMock: vi.fn(),
  revokeMantaCloudSessionMock: vi.fn(),
  selectMantaCloudOrgMock: vi.fn(),
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

vi.mock('./profile-cloud-client', async (importOriginal) => ({
  // The real error class: the service branches on `instanceof`, so a stub
  // would make the branch unreachable and the test vacuous.
  MantaCloudRequestError: (await importOriginal<ProfileCloudClientModule>()).MantaCloudRequestError,
  createMantaCloudProfile: createMantaCloudProfileMock,
  exchangeMantaCloudAuthCode: exchangeMantaCloudAuthCodeMock,
  grantMantaCloudSessionDirectly: grantMantaCloudSessionDirectlyMock,
  revokeMantaCloudSession: revokeMantaCloudSessionMock,
  selectMantaCloudOrg: selectMantaCloudOrgMock
}))

import { MantaCloudRequestError } from './profile-cloud-client'
import {
  connectCurrentMantaProfile,
  createCloudLinkedMantaProfile,
  getCurrentMantaProfileAuthStatus,
  selectCurrentMantaProfileOrg,
  signOutCurrentMantaProfile
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

function configureCloudEnv(): void {
  vi.stubEnv('MANTA_CLOUD_API_URL', 'https://manta-cloud.example')
  vi.stubEnv('MANTA_CLOUD_CLIENT_ID', 'desktop-client')
}

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
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

describe('Manta cloud profile service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'manta-cloud-service-'))
    beginMantaCloudPkceFlowMock.mockReset()
    createMantaCloudProfileMock.mockReset()
    exchangeMantaCloudAuthCodeMock.mockReset()
    revokeMantaCloudSessionMock.mockReset()
    selectMantaCloudOrgMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    revokeMantaCloudSessionMock.mockResolvedValue(undefined)
    vi.unstubAllEnvs()
    vi.stubEnv('MANTA_CLOUD_API_URL', '')
    vi.stubEnv('MANTA_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('reports local unconfigured auth without cloud setup', () => {
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    })
  })

  it('connects the active local profile without replacing its local profile ID', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()

    const result = await connectCurrentMantaProfile(userDataPath)

    if (result.status !== 'connected') {
      throw new Error(`Expected connected result, got ${result.status}`)
    }
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({
      id: 'local-default',
      kind: 'cloud-linked',
      cloud: cloudSummary
    })
    expect(exchangeMantaCloudAuthCodeMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ localProfileId: 'local-default', nonce: 'nonce' })
    )
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      persistence: 'encrypted',
      cloud: cloudSummary,
      organizations,
      capabilities
    })
  })

  it('explains a per-user relay instead of quoting its status code', async () => {
    // Sharing an artifact, publishing a skill and five other places call
    // connect() with no form. On a relay that gives each person an account the
    // relay refuses, and 'manta_cloud_request_failed_409' names nothing anyone
    // can act on.
    configureCloudEnv()
    vi.stubEnv('MANTA_CLOUD_ENROLLMENT_SECRET', 'enrol')
    grantMantaCloudSessionDirectlyMock.mockRejectedValue(
      new MantaCloudRequestError(409, 'accounts_required')
    )

    const result = await connectCurrentMantaProfile(userDataPath)

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'accounts_required',
      error:
        'This relay gives each person their own account. Sign in from Settings → Manta Account.'
    })
  })

  it('treats provider-denied sign-in as a cancelled connect attempt', async () => {
    configureCloudEnv()
    beginMantaCloudPkceFlowMock.mockRejectedValue(new Error('manta_cloud_auth_denied'))

    const result = await connectCurrentMantaProfile(userDataPath)

    expect(result.status).toBe('cancelled')
    expect(exchangeMantaCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
  })

  it('does not report a saved cloud session as connected when cloud config is unavailable', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentMantaProfile(userDataPath)
    vi.stubEnv('MANTA_CLOUD_API_URL', '')
    vi.stubEnv('MANTA_CLOUD_CLIENT_ID', '')

    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      configured: false,
      state: 'unconfigured',
      persistence: 'encrypted',
      cloud: cloudSummary,
      setupMessage:
        'No relay is configured. Set one in Settings → Advanced → Manta Cloud endpoints, or run your own from relay-server/.'
    })
    expect(getCurrentMantaProfileAuthStatus(userDataPath).organizations).toBeUndefined()
    expect(getCurrentMantaProfileAuthStatus(userDataPath).capabilities).toBeUndefined()
  })

  it('signs out by removing cloud metadata while keeping the local profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentMantaProfile(userDataPath)

    const result = await signOutCurrentMantaProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({ id: 'local-default', kind: 'local' })
    expect(result.profiles[0]?.cloud).toBeUndefined()
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
    expect(revokeMantaCloudSessionMock).toHaveBeenCalledOnce()
  })

  it('creates a new empty cloud-linked profile with its own cloud session', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentMantaProfile(userDataPath)
    createMantaCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: 1000,
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities: { flags: { share: true, team: true }, refreshedAt: 13 }
    } satisfies MantaCloudSessionExchangeResponse)

    const result = await createCloudLinkedMantaProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    if (result.status !== 'created') {
      throw new Error(`Expected created result, got ${result.status}`)
    }
    expect(result.profile).toMatchObject({
      id: expect.stringMatching(/^cloud-/),
      name: 'Acme',
      kind: 'cloud-linked',
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-2' })
    })
    expect(createMantaCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('selects an organization for a connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulConnect()
    await connectCurrentMantaProfile(userDataPath)
    const orgCloudSummary = {
      ...cloudSummary,
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    }
    selectMantaCloudOrgMock.mockResolvedValue({
      cloud: orgCloudSummary,
      organizations,
      capabilities: { flags: { share: true, sso: true }, refreshedAt: 12 }
    })

    const result = await selectCurrentMantaProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectMantaCloudOrgMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      'org-1'
    )
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    })
    expect(getCurrentMantaProfileAuthStatus(userDataPath).organizations).toEqual(organizations)
  })
})
