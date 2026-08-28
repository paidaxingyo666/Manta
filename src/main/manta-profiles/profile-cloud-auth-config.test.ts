import { describe, expect, it, vi } from 'vitest'
import {
  allowsPlaintextMantaCloudSession,
  getMantaCloudAuthConfig,
  isMantaCloudDevAuthEnabled
} from './profile-cloud-auth-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

describe('Manta cloud auth config', () => {
  it('reports unconfigured without both API URL and client ID', () => {
    expect(getMantaCloudAuthConfig({})).toEqual({
      configured: false,
      setupMessage: 'Manta Cloud sign-in is not configured for this build.'
    })
  })

  it('builds default desktop auth endpoints from the API URL', () => {
    const state = getMantaCloudAuthConfig({
      MANTA_CLOUD_API_URL: 'https://manta-cloud.example/',
      MANTA_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://manta-cloud.example',
        authorizeEndpoint: 'https://manta-cloud.example/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://manta-cloud.example/v1/desktop/auth/session',
        refreshEndpoint: 'https://manta-cloud.example/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://manta-cloud.example/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://manta-cloud.example/v1/desktop/auth/profile',
        orgEndpoint: 'https://manta-cloud.example/v1/desktop/auth/org',
        logoutEndpoint: 'https://manta-cloud.example/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://manta-cloud.example/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.manta.sh.cn',
        clientId: 'desktop-client',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('uses first-party production endpoints without runtime env in packaged builds', () => {
    expect(getMantaCloudAuthConfig({}, true)).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://login.manta.sh.cn',
        authorizeEndpoint: 'https://login.manta.sh.cn/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://login.manta.sh.cn/v1/desktop/auth/session',
        refreshEndpoint: 'https://login.manta.sh.cn/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://login.manta.sh.cn/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://login.manta.sh.cn/v1/desktop/auth/profile',
        orgEndpoint: 'https://login.manta.sh.cn/v1/desktop/auth/org',
        logoutEndpoint: 'https://login.manta.sh.cn/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://login.manta.sh.cn/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.manta.sh.cn',
        clientId: 'manta-desktop',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('allows loopback HTTP endpoints for local desktop auth development', () => {
    const state = getMantaCloudAuthConfig({
      MANTA_CLOUD_API_URL: 'http://localhost:4100',
      MANTA_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state.configured).toBe(true)
  })

  it('rejects loopback HTTP endpoints in packaged builds', () => {
    expect(
      getMantaCloudAuthConfig(
        {
          MANTA_CLOUD_API_URL: 'http://localhost:4100',
          MANTA_CLOUD_CLIENT_ID: 'desktop-client'
        },
        true
      )
    ).toMatchObject({ configured: false })

    const httpsState = getMantaCloudAuthConfig(
      {
        MANTA_CLOUD_API_URL: 'https://manta-cloud.example',
        MANTA_CLOUD_CLIENT_ID: 'desktop-client'
      },
      true
    )
    expect(httpsState.configured).toBe(true)
  })

  it('rejects non-HTTPS non-loopback API URLs', () => {
    expect(
      getMantaCloudAuthConfig({
        MANTA_CLOUD_API_URL: 'http://manta-cloud.example',
        MANTA_CLOUD_CLIENT_ID: 'desktop-client'
      })
    ).toMatchObject({ configured: false })
  })

  it('allows dev plaintext sessions only outside production', () => {
    expect(
      allowsPlaintextMantaCloudSession({
        MANTA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      allowsPlaintextMantaCloudSession({
        MANTA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })

  it('ignores dev flags in packaged builds even without NODE_ENV', () => {
    // Why: packaged main bundles never define NODE_ENV, so packaged-ness must
    // gate the escape hatches on its own.
    expect(allowsPlaintextMantaCloudSession({ MANTA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)).toBe(
      false
    )
    expect(isMantaCloudDevAuthEnabled({ MANTA_CLOUD_DEV_AUTH: '1' }, true)).toBe(false)
  })

  it('allows local dev auth only outside production', () => {
    expect(
      isMantaCloudDevAuthEnabled({
        MANTA_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      isMantaCloudDevAuthEnabled({
        MANTA_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })
})
