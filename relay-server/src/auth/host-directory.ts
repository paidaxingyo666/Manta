/**
 * The account's machine list.
 *
 * Served over HTTP rather than on the control leg on purpose: the control leg
 * is only held open while something is actually paired, and a desktop that has
 * nothing paired yet is exactly the one that needs to see the list. A relay
 * built before accounts existed answers 404 here, which the client reads as
 * "this relay has no directory" instead of as an error.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { json, readJson } from '../shared/http-json.js'
import { RELAY_HOST_ID_PATTERN } from '../shared/protocol.js'
import { constantTimeEqual, type AuthOptions } from './auth-options.js'

/** Bounds what one desktop can write into the snapshot as a label. */
const MAX_LABEL = 120

function label(value: unknown, max = MAX_LABEL): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  // Control characters would travel straight into a renderer list row. Done by
  // code point rather than a regex: a literal control-character class in the
  // source is the thing that makes this hard to review.
  const cleaned = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 0x20 || code === 0x7f ? ' ' : character
    })
    .join('')
    .trim()
  return cleaned ? cleaned.slice(0, max) : undefined
}

export function handleHostList(
  response: ServerResponse,
  options: AuthOptions,
  accountId: string
): void {
  const hosts = options.hosts.ownership.listFor(accountId).map((host) => ({
    relayHostId: host.relayHostId,
    online: options.isHostOnline(host.relayHostId),
    ...(host.lastSeenAt !== undefined ? { lastSeenAt: host.lastSeenAt } : {}),
    ...(host.descriptor?.displayName ? { displayName: host.descriptor.displayName } : {}),
    ...(host.descriptor?.platform ? { platform: host.descriptor.platform } : {}),
    ...(host.descriptor?.appVersion ? { appVersion: host.descriptor.appVersion } : {})
  }))
  json(response, 200, { hosts })
}

/**
 * Publishes what this machine calls itself.
 *
 * Only for a host the caller already owns: claiming happens when a relay token
 * is issued, and a label must never be the thing that creates a record.
 */
export async function handleHostDescribe(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthOptions,
  accountId: string
): Promise<void> {
  const body = await readJson(request)
  const relayHostId = String(body?.relayHostId ?? '')
  if (!RELAY_HOST_ID_PATTERN.test(relayHostId)) {
    json(response, 422, { error: 'invalid_relay_host_id' })
    return
  }
  if (options.hosts.ownership.ownerOf(relayHostId) !== accountId) {
    json(response, 403, { error: 'host_not_owned' })
    return
  }
  const displayName = label(body?.displayName)
  if (!displayName) {
    json(response, 422, { error: 'invalid_display_name' })
    return
  }
  options.hosts.ownership.describe(relayHostId, {
    displayName,
    ...(label(body?.platform, 32) ? { platform: label(body?.platform, 32) as string } : {}),
    ...(label(body?.appVersion, 32) ? { appVersion: label(body?.appVersion, 32) as string } : {}),
    updatedAt: Date.now()
  })
  json(response, 200, { ok: true })
}

/**
 * Moves a machine the legacy account inherited to the account asking for it.
 *
 * On a relay that predates accounts every host belongs to the environment
 * identity. The operator who then registers an account of their own would find
 * their own desktop refused — so the enrolment secret, which is what granted
 * that identity in the first place, is what hands it over. Nothing else can be
 * taken over this way: the transfer only ever moves a host *off* the legacy
 * account, and only for a caller who already holds the deployment's secret.
 */
export async function handleHostClaim(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthOptions,
  accountId: string
): Promise<void> {
  const body = await readJson(request)
  const relayHostId = String(body?.relayHostId ?? '')
  if (!RELAY_HOST_ID_PATTERN.test(relayHostId)) {
    json(response, 422, { error: 'invalid_relay_host_id' })
    return
  }
  const offered = typeof body?.enrollmentSecret === 'string' ? body.enrollmentSecret : ''
  if (!options.enrollmentSecret || !constantTimeEqual(offered, options.enrollmentSecret)) {
    options.logger.warn('auth.host_claim_rejected', { relayHostId })
    json(response, 401, { error: 'invalid_enrollment_secret' })
    return
  }
  const result = options.hosts.ownership.transfer(
    relayHostId,
    options.legacyAccountId,
    accountId,
    options.maxHostsPerAccount
  )
  if (result !== 'ok') {
    json(response, result === 'owned-by-other' ? 403 : 409, {
      error: result === 'owned-by-other' ? 'host_owned_by_another_account' : 'too_many_hosts'
    })
    return
  }
  options.logger.info('auth.host_claimed', { relayHostId })
  json(response, 200, { ok: true })
}

/** Retires a machine: the record and every credential paired to it. */
export async function handleHostForget(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthOptions,
  accountId: string
): Promise<void> {
  const body = await readJson(request)
  const relayHostId = String(body?.relayHostId ?? '')
  if (!RELAY_HOST_ID_PATTERN.test(relayHostId)) {
    json(response, 422, { error: 'invalid_relay_host_id' })
    return
  }
  if (!options.hosts.ownership.release(relayHostId, accountId)) {
    json(response, 404, { error: 'host_not_found' })
    return
  }
  options.logger.info('auth.host_forgotten', { relayHostId })
  json(response, 200, { ok: true })
}
