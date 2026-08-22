import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MantaCloudAuthConfig } from './profile-cloud-auth-config'
import {
  exchangeMantaCloudCredentials,
  MantaCloudCredentialError
} from './profile-cloud-credential-connect'

const fetchMock = vi.fn()

const config: MantaCloudAuthConfig = {
  apiBaseUrl: 'https://relay.example',
  authorizeEndpoint: 'https://relay.example/v1/desktop/auth/authorize',
  sessionEndpoint: 'https://relay.example/v1/desktop/auth/session',
  refreshEndpoint: 'https://relay.example/v1/desktop/auth/refresh',
  capabilitiesEndpoint: 'https://relay.example/v1/desktop/auth/capabilities',
  profileEndpoint: 'https://relay.example/v1/desktop/auth/profile',
  orgEndpoint: 'https://relay.example/v1/desktop/auth/org',
  logoutEndpoint: 'https://relay.example/v1/desktop/auth/logout',
  registerEndpoint: 'https://relay.example/v1/desktop/auth/register',
  loginEndpoint: 'https://relay.example/v1/desktop/auth/login',
  hostsEndpoint: 'https://relay.example/v1/desktop/auth/hosts',
  hostDescribeEndpoint: 'https://relay.example/v1/desktop/auth/host-describe',
  hostForgetEndpoint: 'https://relay.example/v1/desktop/auth/host-forget',
  hostClaimEndpoint: 'https://relay.example/v1/desktop/auth/host-claim',
  relayTokenEndpoint: 'https://relay.example/v1/desktop/auth/relay-token',
  relayDirectorUrl: 'https://relay.example',
  clientId: 'manta-desktop',
  enrollmentSecret: 'open-sesame',
  scope: 'openid profile email offline_access'
}

const sessionBody = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 999,
  cloud: {
    cloudProfileId: 'profile-1',
    userId: 'user-1',
    email: 'ada@example.com',
    displayName: 'Ada'
  },
  capabilities: { flags: { 'relay.use': true }, refreshedAt: 1 }
}

function ok(value: unknown): void {
  fetchMock.mockResolvedValue({ ok: true, json: async () => value })
}

function refuse(status: number, error?: string): void {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    json: async () => (error ? { error } : {}),
    body: null
  })
}

function lastRequest(): { url: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, body: JSON.parse(String(init.body)) as Record<string, unknown> }
}

describe('relay account credentials', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('signs in against the login endpoint and never sends the enrolment secret', async () => {
    ok(sessionBody)
    const result = await exchangeMantaCloudCredentials(config, {
      email: 'ada@example.com',
      password: 'correct-horse',
      mode: 'sign-in'
    })
    expect(result.cloud.userId).toBe('user-1')
    const request = lastRequest()
    expect(request.url).toBe('https://relay.example/v1/desktop/auth/login')
    // The secret gates enrolment and registration, not a password sign-in;
    // sending it anyway would widen where it travels for no gain.
    expect(request.body).toEqual({ email: 'ada@example.com', password: 'correct-horse' })
  })

  it('carries the configured enrolment secret when registering', async () => {
    // Most self-hosted relays gate signup behind the same secret that gates
    // enrolment, so asking the user for it twice would be a papercut.
    ok(sessionBody)
    await exchangeMantaCloudCredentials(config, {
      email: 'ada@example.com',
      password: 'correct-horse',
      mode: 'register',
      displayName: 'Ada'
    })
    const request = lastRequest()
    expect(request.url).toBe('https://relay.example/v1/desktop/auth/register')
    expect(request.body).toMatchObject({ displayName: 'Ada', enrollmentSecret: 'open-sesame' })
  })

  it('keeps the relay error code so the UI can say what went wrong', async () => {
    refuse(401, 'invalid_credentials')
    await expect(
      exchangeMantaCloudCredentials(config, {
        email: 'ada@example.com',
        password: 'wrong',
        mode: 'sign-in'
      })
    ).rejects.toMatchObject({ errorCode: 'invalid_credentials', statusCode: 401 })
  })

  it('reads a 404 as a relay that predates accounts, not as a failure', async () => {
    refuse(404)
    const error = await exchangeMantaCloudCredentials(config, {
      email: 'ada@example.com',
      password: 'correct-horse',
      mode: 'sign-in'
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MantaCloudCredentialError)
    expect((error as Error).message).toContain('too old')
    // A 404 carries no discriminator of its own, so one is synthesised — this
    // is the first thing anyone on an older relay hits, and the renderer needs
    // a code to translate it by.
    expect(error).toMatchObject({ errorCode: 'relay_too_old_to_sign_in' })
  })

  it('tells creating an account apart from signing in on an old relay', async () => {
    refuse(404)
    await expect(
      exchangeMantaCloudCredentials(config, {
        email: 'ada@example.com',
        password: 'correct-horse',
        mode: 'register'
      })
    ).rejects.toMatchObject({ errorCode: 'relay_too_old_to_register' })
  })
})
