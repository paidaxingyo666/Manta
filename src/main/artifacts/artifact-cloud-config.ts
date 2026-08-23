import { app } from 'electron'

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
 * So the allow-list stays; the operator just owns it now. MANTA_ARTIFACTS_API_URL
 * names the host, and a per-call override has to agree with it. Development
 * builds keep the free-form override, gated exactly like the authToken override
 * next to it.
 */
export function resolveArtifactCloudApiUrl(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): string {
  const configured = validateArtifactOrigin(
    env.MANTA_ARTIFACTS_API_URL?.trim() || PRODUCTION_ARTIFACTS_API_URL,
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
