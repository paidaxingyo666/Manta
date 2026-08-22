import { hostname } from 'node:os'
import type {
  ForgetMantaRelayHostResult,
  ListMantaRelayHostsResult,
  MantaRelayHostSummary
} from '../../../shared/manta-relay-hosts'
import { getMantaCloudAuthConfig } from '../../manta-profiles/profile-cloud-auth-config'
import { MantaCloudRequestError } from '../../manta-profiles/profile-cloud-client'
import {
  claimMantaRelayHost,
  describeMantaRelayHost,
  forgetMantaRelayHost,
  listMantaRelayHosts
} from '../../manta-profiles/profile-cloud-account-client'
import { cancelUnreadResponseBody } from '../../lib/unread-response-body'
import { ensureActiveMantaProfile } from '../../manta-profiles/profile-index-store'
import { runWithFreshMantaCloudSession } from '../../manta-profiles/profile-cloud-session-refresh'
import type { MantaCloudAuthConfig } from '../../manta-profiles/profile-cloud-auth-config'
import type { MantaCloudSession } from '../../manta-profiles/profile-cloud-session-store'

/** Resolved from the runtime's E2EE key, which is what the id is a digest of. */
export type RelayHostIdentityReader = () => string | null

let readOwnRelayHostId: RelayHostIdentityReader = () => null

export function setRelayHostIdentityReader(read: RelayHostIdentityReader): void {
  readOwnRelayHostId = read
}

/** A relay built before accounts answers 404, which is a feature check. */
function isMissingDirectory(error: unknown): boolean {
  return error instanceof MantaCloudRequestError && error.statusCode === 404
}

type DirectoryCall<T> = (config: MantaCloudAuthConfig, session: MantaCloudSession) => Promise<T>

async function withDirectory<T>(
  userDataPath: string,
  call: DirectoryCall<T>
): Promise<
  | { status: 'ok'; value: T }
  | { status: 'unsupported' | 'unconfigured' | 'signed-out' }
  | {
      status: 'failed'
      error: string
    }
> {
  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  const active = ensureActiveMantaProfile(userDataPath)
  if (!active.profile.cloud) {
    return { status: 'signed-out' }
  }
  try {
    const result = await runWithFreshMantaCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => call(configState.config, session)
    )
    return result.status === 'ok' ? { status: 'ok', value: result.value } : { status: 'signed-out' }
  } catch (error) {
    if (isMissingDirectory(error)) {
      return { status: 'unsupported' }
    }
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

function toSummaries(
  rows: Awaited<ReturnType<typeof listMantaRelayHosts>>,
  selfRelayHostId: string | null
): MantaRelayHostSummary[] {
  return rows.map((row) => ({
    ...row,
    isThisMachine: selfRelayHostId !== null && row.relayHostId === selfRelayHostId
  }))
}

export async function listRelayHostsForAccount(
  userDataPath: string
): Promise<ListMantaRelayHostsResult> {
  const selfRelayHostId = readOwnRelayHostId()
  const result = await withDirectory(userDataPath, (config, session) =>
    listMantaRelayHosts(config, session.accessToken)
  )
  return result.status === 'ok'
    ? { status: 'ok', hosts: toSummaries(result.value, selfRelayHostId) }
    : result
}

export async function forgetRelayHostForAccount(
  userDataPath: string,
  relayHostId: string
): Promise<ForgetMantaRelayHostResult> {
  const selfRelayHostId = readOwnRelayHostId()
  const result = await withDirectory(userDataPath, async (config, session) => {
    await forgetMantaRelayHost(config, session.accessToken, relayHostId)
    return listMantaRelayHosts(config, session.accessToken)
  })
  return result.status === 'ok'
    ? { status: 'ok', hosts: toSummaries(result.value, selfRelayHostId) }
    : result
}

/**
 * Claims this machine's host id and publishes what it calls itself.
 *
 * Without this a desktop only appears in its owner's list once something has
 * paired with it, because claiming happens when a relay token is minted — and
 * a machine you have not paired anything to is exactly the one you are looking
 * for when you open the list on another computer.
 */
export async function publishThisMachineToRelay(
  userDataPath: string,
  appVersion: string
): Promise<'published' | 'unsupported' | 'skipped' | 'failed'> {
  const relayHostId = readOwnRelayHostId()
  if (!relayHostId) {
    return 'skipped'
  }
  const result = await withDirectory(userDataPath, async (config, session) => {
    // Minting the token is what claims the id; the label is cosmetic and must
    // not be the thing that creates the record.
    await claimOwnHost(config, session.accessToken, relayHostId)
    await describeMantaRelayHost(config, session.accessToken, {
      relayHostId,
      displayName: hostname() || 'Manta desktop',
      platform: process.platform,
      appVersion
    })
    return true
  })
  if (result.status === 'ok') {
    return 'published'
  }
  if (result.status === 'unsupported') {
    return 'unsupported'
  }
  // No relay, or nobody signed in: there is nothing to publish to, which is a
  // normal state at startup and not worth reporting as a failure.
  return result.status === 'failed' ? 'failed' : 'skipped'
}

/**
 * Claims this machine, taking it over from the legacy account if it is there.
 *
 * A relay upgraded from before accounts owns every host under the identity from
 * its environment. Without the takeover, an operator who registers an account
 * of their own signs in successfully and then finds the relay path dead, with a
 * 403 nobody sees.
 */
async function claimOwnHost(
  config: MantaCloudAuthConfig,
  accessToken: string,
  relayHostId: string
): Promise<void> {
  try {
    await mintRelayTokenForOwnHost(config, accessToken, relayHostId)
    return
  } catch (error) {
    const ownedByAnother =
      error instanceof MantaCloudRequestError && error.errorCode === 'host_owned_by_another_account'
    if (!ownedByAnother || !config.enrollmentSecret) {
      throw error
    }
  }
  await claimMantaRelayHost(config, accessToken, relayHostId)
  await mintRelayTokenForOwnHost(config, accessToken, relayHostId)
}

async function mintRelayTokenForOwnHost(
  config: MantaCloudAuthConfig,
  accessToken: string,
  relayHostId: string
): Promise<void> {
  const response = await fetch(config.relayTokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ relayHostId }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) {
    let errorCode: string | undefined
    try {
      const parsed = (await response.json()) as { error?: unknown }
      errorCode = typeof parsed?.error === 'string' ? parsed.error : undefined
    } catch {
      // An unread body under undici can pause the HTTP/1 parser and take the
      // whole process down when the peer closes the socket (manta#8695).
      await cancelUnreadResponseBody(response)
    }
    throw new MantaCloudRequestError(response.status, errorCode)
  }
  // The token itself is not kept: the broker mints its own when it connects,
  // and holding a spare one here would only widen what a leak of this process
  // is worth. The body still has to go somewhere, for the same undici reason.
  await cancelUnreadResponseBody(response)
}
