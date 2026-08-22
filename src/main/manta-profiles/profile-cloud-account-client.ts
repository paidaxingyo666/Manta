import type { MantaCloudAuthConfig } from './profile-cloud-auth-config'
import { MantaCloudRequestError, normalizeMantaCloudSessionResponse } from './profile-cloud-client'
import type { MantaCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'

const ACCOUNT_REQUEST_TIMEOUT_MS = 30_000

/**
 * Posts to an account endpoint and keeps the server's error discriminator.
 *
 * The shared `postJson` deliberately drops the failure body. Here it is the
 * whole point: 'invalid_credentials', 'email_taken' and 'weak_password' each
 * need a different sentence in the sign-in form, and a bare 401 would leave the
 * user guessing which one happened.
 */
async function postAccountJson<T>(url: string, body: unknown, accessToken?: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body),
    // Following a redirect would re-send the password to another origin.
    redirect: 'error',
    signal: AbortSignal.timeout(ACCOUNT_REQUEST_TIMEOUT_MS)
  })
  if (response.ok) {
    return (await response.json()) as T
  }
  let errorCode: string | undefined
  try {
    const parsed = (await response.json()) as { error?: unknown }
    errorCode = typeof parsed?.error === 'string' ? parsed.error : undefined
  } catch {
    await cancelUnreadResponseBody(response)
  }
  throw new MantaCloudRequestError(response.status, errorCode)
}

export type MantaCloudCredentialGrant = {
  email: string
  password: string
  displayName?: string
  enrollmentSecret?: string
}

export async function signInToMantaCloud(
  config: MantaCloudAuthConfig,
  args: MantaCloudCredentialGrant
): Promise<MantaCloudSessionExchangeResponse> {
  return normalizeMantaCloudSessionResponse(
    await postAccountJson(config.loginEndpoint, {
      email: args.email,
      password: args.password
    })
  )
}

/** Creates the account and returns the session it is signed in with. */
export async function registerMantaCloudAccount(
  config: MantaCloudAuthConfig,
  args: MantaCloudCredentialGrant
): Promise<MantaCloudSessionExchangeResponse> {
  return normalizeMantaCloudSessionResponse(
    await postAccountJson(config.registerEndpoint, {
      email: args.email,
      password: args.password,
      ...(args.displayName ? { displayName: args.displayName } : {}),
      // Most self-hosted relays gate signup behind the same secret that gates
      // enrolment; sending the configured one saves asking for it twice.
      ...((args.enrollmentSecret ?? config.enrollmentSecret)
        ? { enrollmentSecret: args.enrollmentSecret ?? config.enrollmentSecret }
        : {})
    })
  )
}

export type MantaRelayHostRow = {
  relayHostId: string
  displayName?: string
  platform?: string
  appVersion?: string
  online: boolean
  lastSeenAt?: number
}

function normalizeHostRow(value: unknown): MantaRelayHostRow | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.relayHostId !== 'string' || !record.relayHostId) {
    return null
  }
  return {
    relayHostId: record.relayHostId,
    online: record.online === true,
    ...(typeof record.displayName === 'string' && record.displayName
      ? { displayName: record.displayName }
      : {}),
    ...(typeof record.platform === 'string' && record.platform
      ? { platform: record.platform }
      : {}),
    ...(typeof record.appVersion === 'string' && record.appVersion
      ? { appVersion: record.appVersion }
      : {}),
    ...(typeof record.lastSeenAt === 'number' && Number.isFinite(record.lastSeenAt)
      ? { lastSeenAt: record.lastSeenAt }
      : {})
  }
}

export async function listMantaRelayHosts(
  config: MantaCloudAuthConfig,
  accessToken: string
): Promise<MantaRelayHostRow[]> {
  const body = await postAccountJson<{ hosts?: unknown }>(config.hostsEndpoint, {}, accessToken)
  if (!Array.isArray(body?.hosts)) {
    return []
  }
  return body.hosts.map(normalizeHostRow).filter((row): row is MantaRelayHostRow => row !== null)
}

/** Publishes what this machine calls itself, so its owner can recognise it. */
export async function describeMantaRelayHost(
  config: MantaCloudAuthConfig,
  accessToken: string,
  descriptor: { relayHostId: string; displayName: string; platform?: string; appVersion?: string }
): Promise<void> {
  await postAccountJson(config.hostDescribeEndpoint, descriptor, accessToken)
}

/**
 * Takes over a machine the legacy account inherited.
 *
 * A relay that predates accounts owns every host under the identity from its
 * environment, so the operator who registers an account of their own would find
 * their own desktop refused. The enrolment secret — which is what granted that
 * identity in the first place — is what hands it over.
 */
export async function claimMantaRelayHost(
  config: MantaCloudAuthConfig,
  accessToken: string,
  relayHostId: string
): Promise<void> {
  if (!config.enrollmentSecret) {
    throw new MantaCloudRequestError(401, 'invalid_enrollment_secret')
  }
  await postAccountJson(
    config.hostClaimEndpoint,
    { relayHostId, enrollmentSecret: config.enrollmentSecret },
    accessToken
  )
}

export async function forgetMantaRelayHost(
  config: MantaCloudAuthConfig,
  accessToken: string,
  relayHostId: string
): Promise<void> {
  await postAccountJson(config.hostForgetEndpoint, { relayHostId }, accessToken)
}
