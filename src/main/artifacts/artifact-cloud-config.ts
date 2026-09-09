import { app } from 'electron'
import { getMantaCloudEndpointOverrides } from '../manta-profiles/profile-cloud-auth-config'

const PRODUCTION_ARTIFACTS_API_URL = 'https://share.manta.sh.cn'

function isPackaged(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

/**
 * Checks the shape of an artifact origin: HTTPS (or loopback HTTP outside a
 * packaged build), and a bare origin with nothing that could smuggle the token
 * into a path, a query string, or a proxy log.
 */
function validateArtifactOrigin(candidate: string, packaged: boolean): string {
  const url = new URL(candidate)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !packaged)) {
    throw new Error('Artifact API URLs must use HTTPS; local development may use loopback HTTP.')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Artifact API URL must be an origin without credentials, paths, or parameters.')
  }
  return url.origin
}

/**
 * The operator's artifact host, from settings.
 *
 * Swallows a failure on purpose: the reader runs against live settings, and a
 * publish must not become unusable because the stored value is unreadable —
 * the caller falls through to the variable and then the built-in default, and
 * validateArtifactOrigin still has the last word over whatever it lands on.
 */
function settingsArtifactsOrigin(): string {
  try {
    return getMantaCloudEndpointOverrides()?.artifactsBaseUrl?.trim() ?? ''
  } catch {
    return ''
  }
}

/**
 * The one origin a Manta access token is allowed to reach.
 *
 * Upstream hardcoded its own domain here. This fork runs no artifact service,
 * so a fixed domain would mean nobody can use the feature — but simply dropping
 * the check is worse than it looks: `apiUrl` is a *per-call* parameter, exposed
 * on every artifacts RPC method and as `manta artifacts --api-url`, while the
 * bearer token comes from the stored session and is not bound to it. With no
 * allow-list, anything that can run one command in a Manta terminal — an agent,
 * a prompt-injected session, a script in the repo — could send that token to a
 * host of its choosing without needing publish permission at all.
 *
 * So the allow-list stays; the operator just owns it now. The settings field
 * names the host, and a per-call override has to agree with it. Development
 * builds keep the free-form override, gated exactly like the authToken override
 * next to it.
 *
 * Why the setting outranks MANTA_ARTIFACTS_API_URL: the variable is only
 * reachable by a build launched from a shell, and a packaged app started from
 * the Dock or Explorer inherits no environment at all — so for the people this
 * feature exists for it was never settable. The variable stays as the way to
 * pin a host for a dev build or a headless server, which is where it works.
 */
export function resolveArtifactCloudApiUrl(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): string {
  const configured = validateArtifactOrigin(
    settingsArtifactsOrigin() ||
      env.MANTA_ARTIFACTS_API_URL?.trim() ||
      PRODUCTION_ARTIFACTS_API_URL,
    packaged
  )
  const candidate = override?.trim()
  if (!candidate) {
    return configured
  }
  const requested = validateArtifactOrigin(candidate, packaged)
  if (requested === configured) {
    return requested
  }
  if (!allowsArtifactCloudAuthOverride(env, packaged)) {
    throw new Error(
      'Artifact API URL overrides are available only in development builds. Set MANTA_ARTIFACTS_API_URL to change the host this build uses.'
    )
  }
  return requested
}

export function allowsArtifactCloudAuthOverride(
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): boolean {
  return env.NODE_ENV !== 'production' && !packaged
}
