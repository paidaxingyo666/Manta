import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  beginMantaCloudPkceFlowMock,
  exchangeMantaCloudAuthCodeMock,
  revokeMantaCloudSessionMock,
  safeStorageMock
} = vi.hoisted(() => ({
  beginMantaCloudPkceFlowMock: vi.fn(),
  exchangeMantaCloudAuthCodeMock: vi.fn(),
  revokeMantaCloudSessionMock: vi.fn(),
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
  createMantaCloudProfile: vi.fn(),
  exchangeMantaCloudAuthCode: exchangeMantaCloudAuthCodeMock,
  refreshMantaCloudCapabilities: vi.fn(),
  refreshMantaCloudSession: vi.fn(),
  revokeMantaCloudSession: revokeMantaCloudSessionMock,
  selectMantaCloudOrg: vi.fn()
}))

import {
  connectCurrentMantaProfile,
  createCloudLinkedMantaProfile,
  getCurrentMantaProfileAuthStatus,
  selectCurrentMantaProfileOrg,
  signOutCurrentMantaProfile
} from './profile-cloud-service'

describe('Manta cloud dev auth service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'manta-cloud-dev-auth-'))
    beginMantaCloudPkceFlowMock.mockReset()
    exchangeMantaCloudAuthCodeMock.mockReset()
    revokeMantaCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('MANTA_CLOUD_DEV_AUTH', '1')
    vi.stubEnv('MANTA_CLOUD_API_URL', '')
    vi.stubEnv('MANTA_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('connects the active profile without PKCE or cloud endpoints', async () => {
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local'
    })

    const result = await connectCurrentMantaProfile(userDataPath)

    expect(result.status).toBe('connected')
    expect(beginMantaCloudPkceFlowMock).not.toHaveBeenCalled()
    expect(exchangeMantaCloudAuthCodeMock).not.toHaveBeenCalled()
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'connected',
      persistence: 'encrypted',
      cloud: {
        cloudProfileId: 'dev-cloud-local-default',
        email: 'dev@manta.local'
      },
      capabilities: {
        flags: expect.objectContaining({ 'share.create': true })
      }
    })
    expect(getCurrentMantaProfileAuthStatus(userDataPath).organizations).toHaveLength(2)
  })

  it('selects dev organizations and creates org-scoped cloud profiles locally', async () => {
    await connectCurrentMantaProfile(userDataPath)

    const selected = await selectCurrentMantaProfileOrg(userDataPath, 'dev-acme')
    const created = await createCloudLinkedMantaProfile(userDataPath, {
      orgId: 'dev-acme',
      name: 'Acme Dev'
    })

    expect(selected.status).toBe('selected')
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'dev-acme',
      activeOrgName: 'Acme Dev'
    })
    expect(created.status).toBe('created')
    if (created.status === 'created') {
      expect(created.profile).toMatchObject({
        name: 'Acme Dev',
        kind: 'cloud-linked',
        cloud: expect.objectContaining({
          activeOrgId: 'dev-acme',
          activeOrgName: 'Acme Dev'
        })
      })
    }
  })

  it('signs out locally without calling the cloud logout endpoint', async () => {
    await connectCurrentMantaProfile(userDataPath)

    const result = await signOutCurrentMantaProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(revokeMantaCloudSessionMock).not.toHaveBeenCalled()
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local',
      persistence: 'none'
    })
  })
})
