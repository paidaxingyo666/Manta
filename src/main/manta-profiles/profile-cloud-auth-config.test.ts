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
      setupMessage:
        'No relay is configured. Set one in Settings → Advanced → Manta Cloud endpoints, or run your own from relay-server/.'
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
        registerEndpoint: 'https://manta-cloud.example/v1/desktop/auth/register',
        loginEndpoint: 'https://manta-cloud.example/v1/desktop/auth/login',
        hostsEndpoint: 'https://manta-cloud.example/v1/desktop/auth/hosts',
        hostDescribeEndpoint: 'https://manta-cloud.example/v1/desktop/auth/host-describe',
        hostForgetEndpoint: 'https://manta-cloud.example/v1/desktop/auth/host-forget',
        hostClaimEndpoint: 'https://manta-cloud.example/v1/desktop/auth/host-claim',
        relayTokenEndpoint: 'https://manta-cloud.example/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://manta-cloud.example',
        clientId: 'desktop-client',
        scope: 'openid profile email offline_access'
      }
    })
  })

  // Why not a built-in endpoint: the relay this fork was developed against is a
  // private server, and shipping its host would point every packaged build at
  // someone else's machine. Sign-in stays off until a relay is named.
  it('leaves sign-in unconfigured in a packaged build with no endpoint set', () => {
    const state = getMantaCloudAuthConfig({}, true)

    expect(state.configured).toBe(false)
    expect(state.configured === false && state.setupMessage).toContain('No relay is configured')
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
    expect(
      allowsPlaintextMantaCloudSession({ MANTA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)
    ).toBe(false)
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

describe('self-hosted endpoint overrides', () => {
  const overrides = {
    apiBaseUrl: 'https://login.selfhost.example',
    relayDirectorUrl: 'https://relay.selfhost.example',
    clientId: 'selfhost-desktop'
  }

  it('uses user overrides when no env vars are set', () => {
    const state = getMantaCloudAuthConfig({}, false, overrides)
    expect(state.configured).toBe(true)
    if (!state.configured) {
      return
    }
    expect(state.config.apiBaseUrl).toBe('https://login.selfhost.example')
    expect(state.config.relayDirectorUrl).toBe('https://relay.selfhost.example')
    expect(state.config.clientId).toBe('selfhost-desktop')
    expect(state.config.relayTokenEndpoint).toBe(
      'https://login.selfhost.example/v1/desktop/auth/relay-token'
    )
  })

  it('lets env vars win over user overrides', () => {
    // Why: e2e runs and dev flows inject MANTA_CLOUD_* and must keep working
    // byte-for-byte even when a developer has a self-hosted config saved.
    const state = getMantaCloudAuthConfig(
      {
        MANTA_CLOUD_API_URL: 'https://env.example',
        MANTA_CLOUD_CLIENT_ID: 'env-client',
        MANTA_RELAY_URL: 'https://env-relay.example'
      },
      false,
      overrides
    )
    expect(state.configured).toBe(true)
    if (!state.configured) {
      return
    }
    expect(state.config.apiBaseUrl).toBe('https://env.example')
    expect(state.config.clientId).toBe('env-client')
    expect(state.config.relayDirectorUrl).toBe('https://env-relay.example')
  })

  it('ignores a non-canonical relay origin and falls back to the API host', () => {
    const state = getMantaCloudAuthConfig({}, false, {
      ...overrides,
      relayDirectorUrl: 'https://relay.selfhost.example/v1'
    })
    expect(state.configured).toBe(true)
    if (!state.configured) {
      return
    }
    expect(state.config.relayDirectorUrl).toBe(state.config.apiBaseUrl)
  })

  it('stays unconfigured when overrides are absent on an unpackaged build', () => {
    expect(getMantaCloudAuthConfig({}, false, null).configured).toBe(false)
  })
})
