import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelTrackingResponse } from '../lib/unread-response-body.test-fixtures'
import type { MantaCloudAuthConfig } from './profile-cloud-auth-config'
import type { MantaCloudSession } from './profile-cloud-session-store'
import {
  createMantaCloudProfile,
  exchangeMantaCloudAuthCode,
  refreshMantaCloudCapabilities,
  refreshMantaCloudSession,
  selectMantaCloudOrg
} from './profile-cloud-client'

const fetchMock = vi.fn()

const config: MantaCloudAuthConfig = {
  apiBaseUrl: 'https://manta-cloud.example',
  authorizeEndpoint: 'https://manta-cloud.example/v1/desktop/auth/authorize',
  sessionEndpoint: 'https://manta-cloud.example/v1/desktop/auth/session',
  refreshEndpoint: 'https://manta-cloud.example/v1/desktop/auth/refresh',
  capabilitiesEndpoint: 'https://manta-cloud.example/v1/desktop/auth/capabilities',
  profileEndpoint: 'https://manta-cloud.example/v1/desktop/auth/profile',
  orgEndpoint: 'https://manta-cloud.example/v1/desktop/auth/org',
  logoutEndpoint: 'https://manta-cloud.example/v1/desktop/auth/logout',
  relayTokenEndpoint: 'https://manta-cloud.example/v1/desktop/auth/relay-token',
  relayDirectorUrl: 'https://relay.example',
  clientId: 'desktop-client',
  scope: 'openid profile email offline_access'
}

const session: MantaCloudSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 999,
  capabilities: { flags: { share: true }, refreshedAt: 1 }
}

function mockFetchJson(value: unknown): void {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => value
  })
}

describe('Manta cloud client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('normalizes session exchange organizations', async () => {
    mockFetchJson({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 999,
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com'
      },
      organizations: [
        { orgId: 'org-1', name: 'Acme', role: 'Admin' },
        { orgId: '', name: 'Ignored' }
      ],
      capabilities: {
        flags: { share: true },
        refreshedAt: 123
      }
    })

    await expect(
      exchangeMantaCloudAuthCode(config, {
        code: 'code',
        codeVerifier: 'verifier',
        nonce: 'nonce',
        redirectUri: 'http://127.0.0.1:4100/auth/callback',
        state: 'state',
        localProfileId: 'local-default'
      })
    ).resolves.toMatchObject({
      organizations: [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.sessionEndpoint,
      expect.objectContaining({
        body: JSON.stringify({
          code: 'code',
          codeVerifier: 'verifier',
          nonce: 'nonce',
          redirectUri: 'http://127.0.0.1:4100/auth/callback',
          state: 'state',
          localProfileId: 'local-default'
        })
      })
    )
  })

  it('normalizes organization selection response metadata', async () => {
    mockFetchJson({
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com',
        activeOrgId: 'org-2',
        activeOrgName: 'Personal'
      },
      organizations: [
        { orgId: 'org-1', name: 'Acme' },
        { orgId: 'org-2', name: 'Personal' }
      ],
      capabilities: {
        flags: { share: false, sso: true },
        refreshedAt: 456
      }
    })

    await expect(selectMantaCloudOrg(config, session, 'org-2')).resolves.toEqual({
      cloud: expect.objectContaining({ activeOrgId: 'org-2', activeOrgName: 'Personal' }),
      organizations: [
        { orgId: 'org-1', name: 'Acme', role: undefined },
        { orgId: 'org-2', name: 'Personal', role: undefined }
      ],
      capabilities: { flags: { share: false, sso: true }, refreshedAt: 456 }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.orgEndpoint,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' })
      })
    )
  })

  it('creates cloud profiles with a profile-scoped session response', async () => {
    mockFetchJson({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: 1000,
      cloud: {
        cloudProfileId: 'cloud-profile-2',
        userId: 'user-1',
        email: 'nina@example.com',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations: [{ orgId: 'org-1', name: 'Acme' }],
      capabilities: {
        flags: { share: true },
        refreshedAt: 789
      }
    })

    await expect(
      createMantaCloudProfile(config, session, { orgId: 'org-1', name: 'Acme' })
    ).resolves.toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-2' }),
      organizations: [{ orgId: 'org-1', name: 'Acme', role: undefined }]
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.profileEndpoint,
      expect.objectContaining({
        body: JSON.stringify({ orgId: 'org-1', name: 'Acme' })
      })
    )
  })

  it('refreshes session material without exposing refresh tokens in URLs', async () => {
    mockFetchJson({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: 2000,
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com'
      },
      capabilities: {
        flags: { share: true },
        refreshedAt: 999
      }
    })

    await expect(refreshMantaCloudSession(config, session)).resolves.toMatchObject({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.refreshEndpoint,
      expect.objectContaining({
        body: JSON.stringify({ refreshToken: 'refresh-token' })
      })
    )
  })

  it('refreshes capability flags and optional org metadata with the current access token', async () => {
    mockFetchJson({
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com'
      },
      organizations: [],
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 1001
      }
    })

    await expect(refreshMantaCloudCapabilities(config, session)).resolves.toEqual({
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-1' }),
      organizations: [],
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 1001
      }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.capabilitiesEndpoint,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' })
      })
    )
  })

  it('trims cloud metadata and drops blank active org fields', async () => {
    mockFetchJson({
      cloud: {
        cloudProfileId: ' cloud-profile-1 ',
        userId: ' user-1 ',
        email: ' nina@example.com ',
        displayName: ' Nina ',
        activeOrgId: ' ',
        activeOrgName: ''
      },
      capabilities: {
        flags: {},
        refreshedAt: 1002
      }
    })

    await expect(refreshMantaCloudCapabilities(config, session)).resolves.toMatchObject({
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com',
        displayName: 'Nina',
        activeOrgId: undefined,
        activeOrgName: undefined
      }
    })
  })

  it('cancels the unread error-response body so bundled undici cannot crash on socket close', async () => {
    let cancelledBodies = 0
    fetchMock.mockResolvedValue(
      cancelTrackingResponse(502, () => {
        cancelledBodies += 1
      })
    )

    await expect(refreshMantaCloudCapabilities(config, session)).rejects.toThrow()
    expect(cancelledBodies).toBe(1)
  })
})

describe('enrolment secret', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  const args = {
    code: 'code',
    codeVerifier: 'verifier',
    nonce: 'nonce',
    redirectUri: 'http://127.0.0.1:4100/auth/callback',
    state: 'state',
    localProfileId: 'local-default'
  }

  const sessionPayload = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 999,
    cloud: { cloudProfileId: 'cloud-profile-1', userId: 'user-1', email: 'nina@example.com' },
    capabilities: { flags: {}, refreshedAt: 1 }
  }

  it('rides in the exchange body, never on a URL', async () => {
    // A self-hosted relay may gate code redemption. The authorize URL opens in
    // a browser, so a secret placed there lands in history and in every proxy
    // log en route — the body is the only place it can travel safely.
    mockFetchJson(sessionPayload)
    await exchangeMantaCloudAuthCode({ ...config, enrollmentSecret: 'open-sesame' }, args)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ enrollmentSecret: 'open-sesame' })
    expect(url).not.toContain('open-sesame')
  })

  it('omits the field when no secret is configured', async () => {
    // The official service must not receive a field it does not know.
    mockFetchJson(sessionPayload)
    await exchangeMantaCloudAuthCode(config, args)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).not.toHaveProperty('enrollmentSecret')
  })
})
