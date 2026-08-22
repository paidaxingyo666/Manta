import { get } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { MantaCloudAuthConfig } from './profile-cloud-auth-config'

const { openExternalMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn()
}))

vi.mock('electron', () => ({
  shell: {
    openExternal: openExternalMock
  }
}))

import { beginMantaCloudPkceFlow } from './profile-cloud-pkce'

type HttpResponse = {
  body: string
  headers: IncomingHttpHeaders
  statusCode: number | undefined
}

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
  registerEndpoint: 'https://manta-cloud.example/v1/desktop/auth/register',
  loginEndpoint: 'https://manta-cloud.example/v1/desktop/auth/login',
  hostsEndpoint: 'https://manta-cloud.example/v1/desktop/auth/hosts',
  hostDescribeEndpoint: 'https://manta-cloud.example/v1/desktop/auth/host-describe',
  hostForgetEndpoint: 'https://manta-cloud.example/v1/desktop/auth/host-forget',
  hostClaimEndpoint: 'https://manta-cloud.example/v1/desktop/auth/host-claim',
  relayDirectorUrl: 'https://relay.example',
  clientId: 'desktop-client',
  scope: 'openid profile email offline_access'
}

function readHttp(url: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      response.setEncoding('utf-8')
      let body = ''
      response.on('data', (chunk: string) => {
        body += chunk
      })
      response.on('end', () => {
        resolve({ body, headers: response.headers, statusCode: response.statusCode })
      })
    })
    request.on('error', reject)
  })
}

function callbackUrl(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

async function startedFlow(): Promise<{
  authUrl: URL
  flow: ReturnType<typeof beginMantaCloudPkceFlow>
  nonce: string
  redirectUri: string
  state: string
}> {
  const flow = beginMantaCloudPkceFlow(config, 'local-default')
  await vi.waitFor(() => expect(openExternalMock).toHaveBeenCalledTimes(1))
  const authUrl = new URL(String(openExternalMock.mock.calls[0]?.[0]))
  const nonce = authUrl.searchParams.get('nonce')
  const redirectUri = authUrl.searchParams.get('redirect_uri')
  const state = authUrl.searchParams.get('state')
  if (!nonce || !redirectUri || !state) {
    throw new Error('Expected PKCE flow to create nonce, redirect_uri, and state')
  }
  return { authUrl, flow, nonce, redirectUri, state }
}

describe('Manta cloud PKCE flow', () => {
  beforeEach(() => {
    openExternalMock.mockReset()
    openExternalMock.mockResolvedValue(undefined)
  })

  it('keeps the loopback listener alive after an invalid callback', async () => {
    const { flow, redirectUri, state } = await startedFlow()

    const invalidResponse = await readHttp(
      callbackUrl(redirectUri, { code: 'wrong-code', state: 'wrong-state' })
    )
    expect(invalidResponse.statusCode).toBe(400)

    const validResponse = await readHttp(callbackUrl(redirectUri, { code: 'real-code', state }))
    expect(validResponse.statusCode).toBe(200)
    expect(validResponse.headers['cache-control']).toBe('no-store')
    expect(validResponse.headers['content-security-policy']).toContain("default-src 'none'")
    expect(validResponse.body).toContain('<h1>Signed in to Manta</h1>')
    expect(validResponse.body).toContain('You can close this tab and return to the app.')
    expect(validResponse.body).not.toContain('class="brand"')
    await expect(flow).resolves.toMatchObject({
      code: 'real-code',
      redirectUri,
      state
    })
  })

  it('rejects a provider error that matches the flow state', async () => {
    const { flow, redirectUri, state } = await startedFlow()
    const observedFlow = flow.catch((error: unknown) => error)

    const response = await readHttp(callbackUrl(redirectUri, { error: 'access_denied', state }))

    expect(response.statusCode).toBe(400)
    await expect(observedFlow).resolves.toMatchObject({ message: 'manta_cloud_auth_denied' })
  })

  it('adds desktop PKCE parameters to the authorize URL', async () => {
    const { authUrl, flow, nonce, redirectUri, state } = await startedFlow()

    expect(authUrl.searchParams.get('client_id')).toBe('desktop-client')
    expect(authUrl.searchParams.get('response_type')).toBe('code')
    expect(authUrl.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(authUrl.searchParams.get('scope')).toBe('openid profile email offline_access')
    expect(authUrl.searchParams.get('nonce')).toBe(nonce)
    expect(authUrl.searchParams.get('state')).toBe(state)
    expect(authUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('local_profile_id')).toBe('local-default')

    await readHttp(callbackUrl(redirectUri, { code: 'real-code', state }))
    await expect(flow).resolves.toMatchObject({ code: 'real-code', nonce })
  })
})
