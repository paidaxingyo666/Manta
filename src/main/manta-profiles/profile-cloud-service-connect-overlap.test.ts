import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  MantaCloudCapabilities,
  MantaCloudOrgSummary,
  MantaProfileCloudSummary
} from '../../shared/manta-profiles'

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
  revokeMantaCloudSession: revokeMantaCloudSessionMock,
  selectMantaCloudOrg: vi.fn()
}))

import {
  connectCurrentMantaProfile,
  getCurrentMantaProfileAuthStatus,
  signOutCurrentMantaProfile
} from './profile-cloud-service'

const earlierCloud: MantaProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const laterCloud: MantaProfileCloudSummary = {
  ...earlierCloud,
  cloudProfileId: 'cloud-profile-2',
  userId: 'user-2',
  email: 'ada@example.com'
}

const capabilities: MantaCloudCapabilities = {
  flags: { share: true },
  refreshedAt: 11
}

const organizations: MantaCloudOrgSummary[] = [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]

describe('Manta cloud overlapping connect', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-cloud-connect-overlap-'))
    beginMantaCloudPkceFlowMock.mockReset()
    exchangeMantaCloudAuthCodeMock.mockReset()
    revokeMantaCloudSessionMock.mockReset()
    revokeMantaCloudSessionMock.mockResolvedValue(undefined)
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.stubEnv('MANTA_CLOUD_API_URL', 'https://manta-cloud.example')
    vi.stubEnv('MANTA_CLOUD_CLIENT_ID', 'desktop-client')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('does not let an earlier sign-in overwrite a later successful connect', async () => {
    let finishFirst!: (value: {
      code: string
      codeVerifier: string
      nonce: string
      redirectUri: string
      state: string
    }) => void
    beginMantaCloudPkceFlowMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = resolve
        })
      )
      .mockResolvedValueOnce({
        code: 'later-code',
        codeVerifier: 'later-verifier',
        nonce: 'later-nonce',
        redirectUri: 'http://127.0.0.1:4101/auth/callback',
        state: 'later-state'
      })
    exchangeMantaCloudAuthCodeMock.mockImplementation(async (_config, args) => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      cloud: args.code === 'later-code' ? laterCloud : earlierCloud,
      organizations,
      capabilities
    }))

    const first = connectCurrentMantaProfile(userDataPath)
    const later = connectCurrentMantaProfile(userDataPath)
    await expect(later).resolves.toMatchObject({ status: 'connected' })
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')

    finishFirst({
      code: 'earlier-code',
      codeVerifier: 'earlier-verifier',
      nonce: 'earlier-nonce',
      redirectUri: 'http://127.0.0.1:4100/auth/callback',
      state: 'earlier-state'
    })
    await expect(first).resolves.toMatchObject({ status: 'cancelled' })
    expect(exchangeMantaCloudAuthCodeMock).toHaveBeenCalledTimes(1)
    expect(exchangeMantaCloudAuthCodeMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ code: 'later-code' })
    )
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
  })

  it('discards an earlier token exchange that finishes after a later wait has linked', async () => {
    type PkceCode = {
      code: string
      codeVerifier: string
      nonce: string
      redirectUri: string
      state: string
    }
    let finishEarlierPkce!: (value: PkceCode) => void
    let finishLaterPkce!: (value: PkceCode) => void
    let finishEarlierExchange!: (value: {
      accessToken: string
      refreshToken: string
      expiresAt: number
      cloud: MantaProfileCloudSummary
      organizations: MantaCloudOrgSummary[]
      capabilities: MantaCloudCapabilities
    }) => void
    let finishLaterExchange!: (value: {
      accessToken: string
      refreshToken: string
      expiresAt: number
      cloud: MantaProfileCloudSummary
      organizations: MantaCloudOrgSummary[]
      capabilities: MantaCloudCapabilities
    }) => void
    beginMantaCloudPkceFlowMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishEarlierPkce = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishLaterPkce = resolve
        })
      )
    exchangeMantaCloudAuthCodeMock.mockImplementation(
      (_config, args) =>
        new Promise((resolve) => {
          if (args.code === 'later-code') {
            finishLaterExchange = resolve
          } else {
            finishEarlierExchange = resolve
          }
        })
    )

    const earlier = connectCurrentMantaProfile(userDataPath)
    const later = connectCurrentMantaProfile(userDataPath)
    finishEarlierPkce({
      code: 'earlier-code',
      codeVerifier: 'earlier-verifier',
      nonce: 'earlier-nonce',
      redirectUri: 'http://127.0.0.1:4100/auth/callback',
      state: 'earlier-state'
    })
    finishLaterPkce({
      code: 'later-code',
      codeVerifier: 'later-verifier',
      nonce: 'later-nonce',
      redirectUri: 'http://127.0.0.1:4101/auth/callback',
      state: 'later-state'
    })
    await vi.waitFor(() => expect(exchangeMantaCloudAuthCodeMock).toHaveBeenCalledTimes(2))

    finishLaterExchange({
      accessToken: 'later-access',
      refreshToken: 'later-refresh',
      expiresAt: Date.now() + 3_600_000,
      cloud: laterCloud,
      organizations,
      capabilities
    })
    await expect(later).resolves.toMatchObject({ status: 'connected' })
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')

    finishEarlierExchange({
      accessToken: 'earlier-access',
      refreshToken: 'earlier-refresh',
      expiresAt: Date.now() + 3_600_000,
      cloud: earlierCloud,
      organizations,
      capabilities
    })
    await expect(earlier).resolves.toMatchObject({ status: 'cancelled' })
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
  })

  it('does not relink an in-flight later wait after sign-out', async () => {
    type PkceCode = {
      code: string
      codeVerifier: string
      nonce: string
      redirectUri: string
      state: string
    }
    let finishEarlierPkce!: (value: PkceCode) => void
    let finishLaterPkce!: (value: PkceCode) => void
    beginMantaCloudPkceFlowMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishEarlierPkce = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishLaterPkce = resolve
        })
      )
    exchangeMantaCloudAuthCodeMock.mockImplementation(async (_config, args) => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      cloud: args.code === 'later-code' ? laterCloud : earlierCloud,
      organizations,
      capabilities
    }))

    const earlier = connectCurrentMantaProfile(userDataPath)
    const later = connectCurrentMantaProfile(userDataPath)
    finishEarlierPkce({
      code: 'earlier-code',
      codeVerifier: 'earlier-verifier',
      nonce: 'earlier-nonce',
      redirectUri: 'http://127.0.0.1:4100/auth/callback',
      state: 'earlier-state'
    })
    await expect(earlier).resolves.toMatchObject({ status: 'connected' })
    await expect(signOutCurrentMantaProfile(userDataPath)).resolves.toMatchObject({
      status: 'signed-out'
    })
    finishLaterPkce({
      code: 'later-code',
      codeVerifier: 'later-verifier',
      nonce: 'later-nonce',
      redirectUri: 'http://127.0.0.1:4101/auth/callback',
      state: 'later-state'
    })
    await expect(later).resolves.toMatchObject({ status: 'cancelled' })
    expect(exchangeMantaCloudAuthCodeMock).toHaveBeenCalledTimes(1)
    expect(getCurrentMantaProfileAuthStatus(userDataPath)).toMatchObject({ state: 'local' })
  })
})
