import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MantaCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import type * as ProfileCloudClient from './profile-cloud-client'
import type * as ProfileCloudCredentialConnect from './profile-cloud-credential-connect'

const mocks = vi.hoisted(() => ({
  pkce: vi.fn(),
  code: vi.fn(),
  credentials: vi.fn(),
  enrollment: vi.fn(),
  revoke: vi.fn()
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString('utf-8'),
    encryptString: (value: string) => Buffer.from(value, 'utf-8'),
    isEncryptionAvailable: () => true
  }
}))
vi.mock('./profile-cloud-pkce', () => ({ beginMantaCloudPkceFlow: mocks.pkce }))
vi.mock('./profile-cloud-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ProfileCloudClient>()),
  exchangeMantaCloudAuthCode: mocks.code,
  grantMantaCloudSessionDirectly: mocks.enrollment,
  revokeMantaCloudSession: mocks.revoke
}))
vi.mock('./profile-cloud-credential-connect', async (importOriginal) => ({
  ...(await importOriginal<typeof ProfileCloudCredentialConnect>()),
  exchangeMantaCloudCredentials: mocks.credentials
}))

import {
  connectCurrentMantaProfile,
  getCurrentMantaProfileAuthStatus,
  signOutCurrentMantaProfile
} from './profile-cloud-service'

function exchange(userId: string): MantaCloudSessionExchangeResponse {
  return {
    accessToken: `${userId}-access`,
    refreshToken: `${userId}-refresh`,
    expiresAt: Date.now() + 3_600_000,
    cloud: {
      cloudProfileId: `${userId}-profile`,
      userId,
      email: `${userId}@example.com`,
      linkedAt: 10
    },
    capabilities: { flags: { share: true }, refreshedAt: 11 }
  }
}

const credentials = {
  email: 'ada@example.com',
  password: 'test-password',
  mode: 'sign-in' as const
}

describe('self-hosted profile connect fences', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    userDataPath = mkdtempSync(join(tmpdir(), 'manta-direct-connect-race-'))
    vi.stubEnv('MANTA_CLOUD_API_URL', 'https://manta-cloud.example')
    vi.stubEnv('MANTA_CLOUD_CLIENT_ID', 'desktop-client')
    vi.stubEnv('MANTA_CLOUD_ENROLLMENT_SECRET', '')
    vi.stubEnv('MANTA_CLOUD_DEV_AUTH', '')
    mocks.pkce.mockResolvedValue({
      code: 'code',
      codeVerifier: 'verifier',
      nonce: 'nonce',
      redirectUri: 'http://127.0.0.1:4100/auth/callback',
      state: 'state'
    })
    mocks.revoke.mockResolvedValue(undefined)
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('discards a password exchange after a later browser sign-in links', async () => {
    const pending = Promise.withResolvers<MantaCloudSessionExchangeResponse>()
    mocks.credentials.mockReturnValue(pending.promise)
    mocks.code.mockResolvedValue(exchange('later'))

    const earlier = connectCurrentMantaProfile(userDataPath, { credentials })
    await expect(connectCurrentMantaProfile(userDataPath)).resolves.toMatchObject({
      status: 'connected'
    })
    pending.resolve(exchange('earlier'))

    await expect(earlier).resolves.toMatchObject({ status: 'cancelled' })
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud?.userId).toBe('later')
  })

  it('lets explicit credentials replace a pending shared enrollment', async () => {
    vi.stubEnv('MANTA_CLOUD_ENROLLMENT_SECRET', 'shared-enrollment')
    const pending = Promise.withResolvers<MantaCloudSessionExchangeResponse>()
    mocks.enrollment.mockReturnValue(pending.promise)
    mocks.credentials.mockResolvedValue(exchange('personal'))

    const shared = connectCurrentMantaProfile(userDataPath)
    await expect(connectCurrentMantaProfile(userDataPath, { credentials })).resolves.toMatchObject({
      status: 'connected'
    })
    pending.resolve(exchange('shared'))

    await expect(shared).resolves.toMatchObject({ status: 'cancelled' })
    expect(mocks.enrollment).toHaveBeenCalledOnce()
    expect(mocks.credentials).toHaveBeenCalledWith(expect.any(Object), credentials)
    expect(mocks.pkce).not.toHaveBeenCalled()
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud?.userId).toBe('personal')
  })

  it.each(['credentials', 'enrollment'] as const)(
    'does not relink a pending %s exchange after sign-out',
    async (method) => {
      const pending = Promise.withResolvers<MantaCloudSessionExchangeResponse>()
      mocks[method].mockReturnValue(pending.promise)
      if (method === 'enrollment') {
        vi.stubEnv('MANTA_CLOUD_ENROLLMENT_SECRET', 'shared-enrollment')
      }
      const connecting = connectCurrentMantaProfile(
        userDataPath,
        method === 'credentials' ? { credentials } : undefined
      )
      await signOutCurrentMantaProfile(userDataPath)
      pending.resolve(exchange('signed-out'))

      await expect(connecting).resolves.toMatchObject({ status: 'cancelled' })
      expect(getCurrentMantaProfileAuthStatus(userDataPath).state).toBe('local')
    }
  )

  it('keeps a newer password sign-in when an older revocation finishes', async () => {
    mocks.credentials.mockResolvedValueOnce(exchange('earlier'))
    await connectCurrentMantaProfile(userDataPath, { credentials })
    const revoking = Promise.withResolvers<void>()
    mocks.revoke.mockReturnValue(revoking.promise)
    const signingOut = signOutCurrentMantaProfile(userDataPath)
    mocks.credentials.mockResolvedValueOnce(exchange('later'))
    await connectCurrentMantaProfile(userDataPath, { credentials })
    revoking.resolve()

    await expect(signingOut).resolves.toMatchObject({ status: 'signed-out' })
    expect(getCurrentMantaProfileAuthStatus(userDataPath).cloud?.userId).toBe('later')
  })
})
