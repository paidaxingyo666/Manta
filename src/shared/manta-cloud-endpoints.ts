/**
 * Self-hosted Manta Cloud / Relay endpoint overrides.
 *
 * Why this lives in shared: the renderer settings UI and the main process must
 * apply byte-identical rules. `profile-cloud-auth-config.ts` imports `electron`
 * and cannot be reused from the renderer, so the normalization is duplicated
 * here deliberately and kept in lockstep with `cleanUrl` / `cleanOrigin` there.
 */

export type MantaCloudEndpointOverrides = {
  /** Base URL for sign-in and the relay-token issuer. */
  apiBaseUrl?: string
  /** Optional separate authorize host; defaults to apiBaseUrl. */
  authBaseUrl?: string
  /** Relay director origin. Must be a bare origin (no path/query/hash). */
  relayDirectorUrl?: string
  /** OAuth client id registered with the self-hosted auth server. */
  clientId?: string
  /**
   * Shared secret a self-hosted relay may require when redeeming an auth code.
   *
   * Sent in the body of the session exchange, never as a query parameter: the
   * authorize URL is opened in a browser, so anything on it lands in history
   * and in every proxy log along the way.
   */
  enrollmentSecret?: string
}

export type MantaCloudEndpointValidation =
  | { ok: true; value: string; message?: undefined }
  | { ok: false; value: ''; message: string }

const ENDPOINT_URL_MAX_LENGTH = 2048
const CLIENT_ID_MAX_LENGTH = 256
const ENROLLMENT_SECRET_MAX_LENGTH = 512
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]+$/

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

/**
 * Mirrors `cleanUrl` in src/main/manta-profiles/profile-cloud-auth-config.ts.
 * An empty value is valid and means "fall back to the built-in endpoint".
 */
export function normalizeMantaCloudEndpointUrl(
  value: unknown,
  options: { allowLoopbackHttp?: boolean } = {}
): MantaCloudEndpointValidation {
  if (typeof value !== 'string') {
    return { ok: true, value: '' }
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: true, value: '' }
  }
  if (trimmed.length > ENDPOINT_URL_MAX_LENGTH) {
    return { ok: false, value: '', message: 'Endpoint URL is too long.' }
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, value: '', message: 'Enter a valid URL, including https://.' }
  }
  if (parsed.protocol !== 'https:') {
    // Why: the auth leg carries bearer tokens with no second encryption layer,
    // so plain HTTP is only ever acceptable against loopback in development.
    if (!(options.allowLoopbackHttp === true && isLoopbackHost(parsed.hostname))) {
      return { ok: false, value: '', message: 'Endpoint must use https://.' }
    }
  }
  return { ok: true, value: parsed.toString().replace(/\/$/, '') }
}

/**
 * Mirrors `cleanOrigin`: the relay director must be a bare origin, otherwise the
 * runtime silently discards it and falls back to the official relay.
 */
export function normalizeMantaCloudOrigin(
  value: unknown,
  options: { allowLoopbackHttp?: boolean } = {}
): MantaCloudEndpointValidation {
  const normalized = normalizeMantaCloudEndpointUrl(value, options)
  if (!normalized.ok || !normalized.value) {
    return normalized
  }
  const parsed = new URL(normalized.value)
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return {
      ok: false,
      value: '',
      message: 'Relay address must be a bare origin, without a path or query.'
    }
  }
  return { ok: true, value: parsed.origin }
}

/**
 * An enrolment secret is opaque to us — the relay chooses it. So this only
 * bounds the length and rejects control characters, rather than imposing a
 * shape the operator's `openssl rand` output might not match.
 */
export function normalizeMantaCloudEnrollmentSecret(value: unknown): MantaCloudEndpointValidation {
  if (typeof value !== 'string') {
    return { ok: true, value: '' }
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: true, value: '' }
  }
  if (trimmed.length > ENROLLMENT_SECRET_MAX_LENGTH) {
    return { ok: false, value: '', message: 'Enrolment secret is too long.' }
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, value: '', message: 'Enrolment secret may not contain control characters.' }
  }
  return { ok: true, value: trimmed }
}

export function normalizeMantaCloudClientId(value: unknown): MantaCloudEndpointValidation {
  if (typeof value !== 'string') {
    return { ok: true, value: '' }
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: true, value: '' }
  }
  if (trimmed.length > CLIENT_ID_MAX_LENGTH) {
    return { ok: false, value: '', message: 'Client ID is too long.' }
  }
  if (!CLIENT_ID_PATTERN.test(trimmed)) {
    return { ok: false, value: '', message: 'Client ID may only use letters, digits, . _ and -.' }
  }
  return { ok: true, value: trimmed }
}

/**
 * Why both must be set together: a custom auth server issues relay tokens the
 * official director will reject, and that failure surfaces as a non-retried 400
 * that leaves relay offline for minutes with no actionable error.
 */
export function mantaCloudEndpointsArePaired(
  overrides: MantaCloudEndpointOverrides | null
): boolean {
  const api = overrides?.apiBaseUrl?.trim()
  const relay = overrides?.relayDirectorUrl?.trim()
  return Boolean(api) === Boolean(relay)
}

/** Drops invalid fields; returns undefined when nothing valid remains. */
export function normalizeMantaCloudEndpointOverrides(
  value: unknown,
  options: { allowLoopbackHttp?: boolean } = {}
): MantaCloudEndpointOverrides | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const source = value as Record<string, unknown>
  const next: MantaCloudEndpointOverrides = {}
  const apiBaseUrl = normalizeMantaCloudEndpointUrl(source.apiBaseUrl, options)
  if (apiBaseUrl.ok && apiBaseUrl.value) {
    next.apiBaseUrl = apiBaseUrl.value
  }
  const authBaseUrl = normalizeMantaCloudEndpointUrl(source.authBaseUrl, options)
  if (authBaseUrl.ok && authBaseUrl.value) {
    next.authBaseUrl = authBaseUrl.value
  }
  const relayDirectorUrl = normalizeMantaCloudOrigin(source.relayDirectorUrl, options)
  if (relayDirectorUrl.ok && relayDirectorUrl.value) {
    next.relayDirectorUrl = relayDirectorUrl.value
  }
  const enrollmentSecret = normalizeMantaCloudEnrollmentSecret(source.enrollmentSecret)
  if (enrollmentSecret.ok && enrollmentSecret.value) {
    next.enrollmentSecret = enrollmentSecret.value
  }
  const clientId = normalizeMantaCloudClientId(source.clientId)
  if (clientId.ok && clientId.value) {
    next.clientId = clientId.value
  }
  return Object.keys(next).length > 0 ? next : undefined
}
