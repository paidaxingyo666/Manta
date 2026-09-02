import { app } from 'electron'
import type { MantaCloudEndpointOverrides } from '../../shared/manta-cloud-endpoints'

// Why: this module must not import the Store (store.ts already depends on
// manta-profiles, so that would cycle). The main process injects a getter that
// reads the already-loaded in-memory settings — no disk I/O, no async, and in
// tests the default resolver stays null so a developer's local config can never
// make assertions flaky.
type EndpointOverrideReader = () => MantaCloudEndpointOverrides | null
let readEndpointOverrides: EndpointOverrideReader = () => null

export function setMantaCloudEndpointOverrideSource(read: EndpointOverrideReader): void {
  readEndpointOverrides = read
}

export function resetMantaCloudEndpointOverrideSourceForTests(): void {
  readEndpointOverrides = () => null
}

export type MantaCloudAuthConfig = {
  apiBaseUrl: string
  authorizeEndpoint: string
  sessionEndpoint: string
  refreshEndpoint: string
  capabilitiesEndpoint: string
  profileEndpoint: string
  orgEndpoint: string
  logoutEndpoint: string
  /** Account endpoints; a relay that predates accounts answers 404 on these. */
  registerEndpoint: string
  loginEndpoint: string
  hostsEndpoint: string
  hostDescribeEndpoint: string
  hostForgetEndpoint: string
  hostClaimEndpoint: string
  methodsEndpoint: string
  relayTokenEndpoint: string
  relayDirectorUrl: string
  clientId: string
  /** Empty unless the self-hosted relay requires one at code redemption. */
  enrollmentSecret?: string
  scope: string
}

const DEFAULT_SCOPE = 'openid profile email offline_access'
const DEFAULT_CLIENT_ID = 'manta-desktop'

// Why there is no built-in endpoint: this fork has no cloud service of its own,
// and the relay it was developed against is one person's private server behind
// an enrolment secret. Baking that host in would point every packaged build at
// it — traffic its owner never invited, for a service that would refuse the
// caller anyway. Sign-in stays off until someone names their own relay, which
// is the whole point of a self-hosted fork.

// Why: packaged main bundles never define NODE_ENV, so packaged-ness is the
// only reliable production signal for gating dev-only auth escape hatches.
function isPackagedMantaBuild(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

function cleanUrl(value: string | undefined, allowLoopbackHttp: boolean): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = new URL(trimmed)
    const loopbackHost =
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '[::1]'
    if (parsed.protocol !== 'https:' && !(loopbackHost && allowLoopbackHttp)) {
      return null
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function endpoint(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString()
}

function cleanOrigin(value: string | undefined, allowLoopbackHttp: boolean): string | null {
  const cleaned = cleanUrl(value, allowLoopbackHttp)
  if (!cleaned) {
    return null
  }
  const parsed = new URL(cleaned)
  return parsed.pathname === '/' && !parsed.search && !parsed.hash ? parsed.origin : null
}

export function getMantaCloudAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedMantaBuild(),
  overrides: MantaCloudEndpointOverrides | null = readEndpointOverrides()
):
  | { configured: true; config: MantaCloudAuthConfig }
  | { configured: false; setupMessage: string } {
  // Why: loopback HTTP endpoints are a local-development convenience only;
  // packaged builds must not accept plain-HTTP token endpoints via env vars.
  const allowLoopbackHttp = !packaged
  const cleanEndpointUrl = (value: string | undefined): string | null =>
    cleanUrl(value, allowLoopbackHttp)
  const configuredApiBaseUrl = env.MANTA_CLOUD_API_URL?.trim() || overrides?.apiBaseUrl?.trim()
  const apiBaseUrl = configuredApiBaseUrl ? cleanEndpointUrl(configuredApiBaseUrl) : null
  const clientId =
    env.MANTA_CLOUD_CLIENT_ID?.trim() || overrides?.clientId?.trim() || DEFAULT_CLIENT_ID
  if (!apiBaseUrl || !clientId) {
    return {
      configured: false,
      setupMessage:
        'No relay is configured. Set one in Settings → Advanced → Manta Cloud endpoints, or run your own from relay-server/.'
    }
  }

  const authBaseUrl =
    cleanEndpointUrl(env.MANTA_CLOUD_AUTH_URL) ??
    cleanEndpointUrl(overrides?.authBaseUrl) ??
    apiBaseUrl
  return {
    configured: true,
    config: {
      apiBaseUrl,
      authorizeEndpoint:
        cleanEndpointUrl(env.MANTA_CLOUD_AUTHORIZE_URL) ??
        endpoint(authBaseUrl, '/v1/desktop/auth/authorize'),
      sessionEndpoint:
        cleanEndpointUrl(env.MANTA_CLOUD_SESSION_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/session'),
      refreshEndpoint:
        cleanEndpointUrl(env.MANTA_CLOUD_REFRESH_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/refresh'),
      capabilitiesEndpoint:
        cleanEndpointUrl(env.MANTA_CLOUD_CAPABILITIES_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/capabilities'),
      profileEndpoint:
        cleanEndpointUrl(env.MANTA_CLOUD_PROFILE_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/profile'),
      orgEndpoint:
        cleanEndpointUrl(env.MANTA_CLOUD_ORG_URL) ?? endpoint(apiBaseUrl, '/v1/desktop/auth/org'),
      logoutEndpoint:
        cleanEndpointUrl(env.MANTA_CLOUD_LOGOUT_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/logout'),
      // No env overrides: these only exist on a Manta relay, so there is
      // nothing to point them at independently of the API base.
      registerEndpoint: endpoint(apiBaseUrl, '/v1/desktop/auth/register'),
      loginEndpoint: endpoint(apiBaseUrl, '/v1/desktop/auth/login'),
      hostsEndpoint: endpoint(apiBaseUrl, '/v1/desktop/auth/hosts'),
      hostDescribeEndpoint: endpoint(apiBaseUrl, '/v1/desktop/auth/host-describe'),
      hostForgetEndpoint: endpoint(apiBaseUrl, '/v1/desktop/auth/host-forget'),
      hostClaimEndpoint: endpoint(apiBaseUrl, '/v1/desktop/auth/host-claim'),
      methodsEndpoint: endpoint(apiBaseUrl, '/v1/desktop/auth/methods'),
      relayTokenEndpoint:
        cleanEndpointUrl(env.MANTA_CLOUD_RELAY_TOKEN_URL) ??
        endpoint(apiBaseUrl, '/v1/desktop/auth/relay-token'),
      // Falls back to the configured API host rather than to a built-in one:
      // a self-hosted deployment usually serves both from the same origin.
      relayDirectorUrl:
        cleanOrigin(env.MANTA_RELAY_URL, allowLoopbackHttp) ??
        cleanOrigin(overrides?.relayDirectorUrl, allowLoopbackHttp) ??
        apiBaseUrl,
      clientId,
      // Sent in the session-exchange body, never on the authorize URL: that
      // one opens in a browser, so anything on it lands in history and logs.
      enrollmentSecret:
        env.MANTA_CLOUD_ENROLLMENT_SECRET?.trim() ||
        overrides?.enrollmentSecret?.trim() ||
        undefined,
      scope: env.MANTA_CLOUD_AUTH_SCOPE?.trim() || DEFAULT_SCOPE
    }
  }
}

export function allowsPlaintextMantaCloudSession(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedMantaBuild()
): boolean {
  return (
    env.MANTA_CLOUD_ALLOW_PLAINTEXT_SESSION === '1' && env.NODE_ENV !== 'production' && !packaged
  )
}

export function isMantaCloudDevAuthEnabled(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedMantaBuild()
): boolean {
  return env.MANTA_CLOUD_DEV_AUTH === '1' && env.NODE_ENV !== 'production' && !packaged
}
