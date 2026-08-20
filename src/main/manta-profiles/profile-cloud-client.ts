import type {
  MantaCloudCapabilities,
  MantaCloudOrgSummary,
  MantaProfileCloudSummary
} from '../../shared/manta-profiles'
import type { MantaCloudAuthConfig } from './profile-cloud-auth-config'
import type { MantaCloudSession } from './profile-cloud-session-store'
import type { MantaCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'

type ExchangeCodeArgs = {
  code: string
  codeVerifier: string
  nonce: string
  redirectUri: string
  state: string
  localProfileId: string
}

type CreateCloudProfileArgs = {
  orgId?: string
  name?: string
}

type SelectOrgResponse = {
  cloud: MantaProfileCloudSummary
  organizations?: MantaCloudOrgSummary[]
  capabilities: MantaCloudCapabilities
}

type CapabilityRefreshResponse = {
  cloud?: MantaProfileCloudSummary
  organizations?: MantaCloudOrgSummary[]
  capabilities: MantaCloudCapabilities
}

export class MantaCloudRequestError extends Error {
  // Why: `errorCode` carries the server's JSON `{error}` discriminator (e.g.
  // 'already_member', 'cannot_remove_self') so callers can distinguish the
  // precise 4xx cause without re-reading the response body.
  constructor(
    public readonly statusCode: number,
    public readonly errorCode?: string
  ) {
    super(`manta_cloud_request_failed_${statusCode}`)
    this.name = 'MantaCloudRequestError'
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid_manta_cloud_${field}`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`invalid_manta_cloud_${field}`)
  }
  return trimmed
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function assertNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid_manta_cloud_${field}`)
  }
  return value
}

function normalizeCapabilities(value: unknown): MantaCloudCapabilities {
  if (!value || typeof value !== 'object') {
    return { flags: {}, refreshedAt: Date.now() }
  }
  const record = value as Record<string, unknown>
  const rawFlags = record.flags
  const flags: Record<string, boolean> = {}
  if (rawFlags && typeof rawFlags === 'object' && !Array.isArray(rawFlags)) {
    for (const [key, flag] of Object.entries(rawFlags)) {
      if (typeof flag === 'boolean') {
        flags[key] = flag
      }
    }
  }
  return {
    flags,
    refreshedAt:
      typeof record.refreshedAt === 'number' && Number.isFinite(record.refreshedAt)
        ? record.refreshedAt
        : Date.now()
  }
}

function normalizeOrganizations(value: unknown): MantaCloudOrgSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const organizations: MantaCloudOrgSummary[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.orgId !== 'string' || typeof record.name !== 'string') {
      continue
    }
    const orgId = record.orgId.trim()
    const name = record.name.trim()
    if (!orgId || !name) {
      continue
    }
    organizations.push({
      orgId,
      name,
      role: typeof record.role === 'string' && record.role.trim() ? record.role.trim() : undefined
    })
  }
  return organizations
}

function normalizeCloudSummary(value: unknown): MantaProfileCloudSummary {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid_manta_cloud_profile')
  }
  const record = value as Record<string, unknown>
  return {
    cloudProfileId: assertString(record.cloudProfileId, 'profile_id'),
    userId: assertString(record.userId, 'user_id'),
    email: assertString(record.email, 'email'),
    displayName: optionalString(record.displayName),
    activeOrgId: optionalString(record.activeOrgId),
    activeOrgName: optionalString(record.activeOrgName),
    linkedAt:
      typeof record.linkedAt === 'number' && Number.isFinite(record.linkedAt)
        ? record.linkedAt
        : Date.now()
  }
}

function normalizeSessionResponse(value: unknown): MantaCloudSessionExchangeResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid_manta_cloud_session')
  }
  const record = value as Record<string, unknown>
  return {
    accessToken: assertString(record.accessToken, 'access_token'),
    refreshToken: assertString(record.refreshToken, 'refresh_token'),
    expiresAt: assertNumber(record.expiresAt, 'expires_at'),
    cloud: normalizeCloudSummary(record.cloud),
    organizations: normalizeOrganizations(record.organizations),
    capabilities: normalizeCapabilities(record.capabilities)
  }
}

const CLOUD_REQUEST_TIMEOUT_MS = 30_000

async function postJson<T>(url: string, body: unknown, accessToken?: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body),
    // Why: these are fixed first-party token endpoints; following a redirect
    // would re-send refresh tokens/code verifiers to another origin, and a
    // stalled server must not hang the renderer's awaited IPC call forever.
    redirect: 'error',
    signal: AbortSignal.timeout(CLOUD_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    throw new MantaCloudRequestError(response.status)
  }
  return (await response.json()) as T
}

export async function exchangeMantaCloudAuthCode(
  config: MantaCloudAuthConfig,
  args: ExchangeCodeArgs
): Promise<MantaCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(config.sessionEndpoint, {
      code: args.code,
      codeVerifier: args.codeVerifier,
      nonce: args.nonce,
      redirectUri: args.redirectUri,
      state: args.state,
      localProfileId: args.localProfileId,
      // Body, not query: the authorize URL is opened in a browser, so a secret
      // on it would land in history and in every proxy log en route. Omitted
      // entirely when unset, so the official service sees no unexpected field.
      ...(config.enrollmentSecret ? { enrollmentSecret: config.enrollmentSecret } : {})
    })
  )
}

/**
 * Exchanges the enrolment secret for a session, with no browser step.
 *
 * The authorization-code flow exists for a hosted service with a real identity
 * provider and a human to sign in. A single-user self-hosted relay has neither,
 * so the browser round trip would only bounce a code straight back. The secret
 * is the credential either way, and skipping the trip means no code ever
 * transits a browser or a loopback listener.
 */
export async function grantMantaCloudSessionDirectly(
  config: MantaCloudAuthConfig,
  localProfileId: string
): Promise<MantaCloudSessionExchangeResponse> {
  if (!config.enrollmentSecret) {
    throw new Error('manta_cloud_direct_grant_unavailable')
  }
  return normalizeSessionResponse(
    await postJson(config.sessionEndpoint, {
      enrollmentSecret: config.enrollmentSecret,
      localProfileId
    })
  )
}

export async function refreshMantaCloudCapabilities(
  config: MantaCloudAuthConfig,
  session: MantaCloudSession
): Promise<CapabilityRefreshResponse> {
  const response = await postJson<{
    cloud?: unknown
    organizations?: unknown
    capabilities: unknown
  }>(config.capabilitiesEndpoint, {}, session.accessToken)
  return {
    cloud: response.cloud === undefined ? undefined : normalizeCloudSummary(response.cloud),
    organizations: normalizeOrganizations(response.organizations),
    capabilities: normalizeCapabilities(response.capabilities)
  }
}

export async function refreshMantaCloudSession(
  config: MantaCloudAuthConfig,
  session: MantaCloudSession
): Promise<MantaCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(config.refreshEndpoint, {
      refreshToken: session.refreshToken
    })
  )
}

export async function createMantaCloudProfile(
  config: MantaCloudAuthConfig,
  session: MantaCloudSession,
  args: CreateCloudProfileArgs
): Promise<MantaCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(
      config.profileEndpoint,
      {
        orgId: args.orgId,
        name: args.name
      },
      session.accessToken
    )
  )
}

export async function selectMantaCloudOrg(
  config: MantaCloudAuthConfig,
  session: MantaCloudSession,
  orgId: string
): Promise<SelectOrgResponse> {
  const response = await postJson<{
    cloud: unknown
    organizations?: unknown
    capabilities: unknown
  }>(config.orgEndpoint, { orgId }, session.accessToken)
  return {
    cloud: normalizeCloudSummary(response.cloud),
    organizations: normalizeOrganizations(response.organizations),
    capabilities: normalizeCapabilities(response.capabilities)
  }
}

export async function revokeMantaCloudSession(
  config: MantaCloudAuthConfig,
  session: MantaCloudSession
): Promise<void> {
  await postJson(config.logoutEndpoint, { refreshToken: session.refreshToken }, session.accessToken)
}
