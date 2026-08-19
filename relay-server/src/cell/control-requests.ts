/**
 * Control-leg request handlers: invites, revocation, credential rotation.
 *
 * These run only after a host has completed its proof, so the caller is
 * authenticated. What is enforced here is *shape* and *budget* — a desktop that
 * is buggy, or has been taken over, must not be able to make the cell hold
 * unbounded state or hand a phone a message it will refuse to parse.
 */
import { INVITE_MAX_LIFETIME_MS, hashCredential, mintToken } from '../shared/protocol.js'
import type { CellStore } from './store.js'
import type { HostSession } from './session.js'
import type { Logger } from '../shared/log.js'
import type { Metrics } from '../metrics.js'
import { safeId, str } from '../shared/wire.js'

export type ControlDeps = {
  store: CellStore
  logger: Logger
  metrics: Metrics
  resumeTtlMs: number
  graceTtlMs: number
  maxInviteAttempts: number
  maxDevicesPerHost: number
  maxLiveInvitesPerHost: number
  maxLedgerEntriesPerHost: number
}

/**
 * The two authorization modes the clients know about.
 *
 * The mode is echoed back verbatim and the phone asserts on it, so an unknown
 * or malformed value must be refused rather than defaulted: silently answering
 * "relay-basis" to a direct upgrade makes the phone abort its rotation journal,
 * and echoing an attacker-chosen string persists it into the ledger.
 */
export type InstallAuthorization =
  | { mode: 'relay-basis'; basisConnId: string }
  | { mode: 'authenticated-direct'; directAuthId: string }

export function parseInstallAuthorization(value: unknown): InstallAuthorization | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    record.mode === 'relay-basis' &&
    typeof record.basisConnId === 'string' &&
    record.basisConnId
  ) {
    return { mode: 'relay-basis', basisConnId: record.basisConnId }
  }
  if (
    record.mode === 'authenticated-direct' &&
    typeof record.directAuthId === 'string' &&
    record.directAuthId
  ) {
    return { mode: 'authenticated-direct', directAuthId: record.directAuthId }
  }
  return null
}

/** Handles one authenticated control request. Returns false for unknown types. */
export function handleControlRequest(
  session: HostSession,
  /** Answers on the socket the request arrived on, not the session's current leg. */
  reply: (payload: unknown) => void,
  message: Record<string, unknown>,
  type: string,
  deps: ControlDeps,
  now: number
): boolean {
  const { store, logger, metrics } = deps
  // safeId, not any string: reqId becomes a key in the idempotency ledger, and
  // an identifier that names a prototype property is not an identifier.
  const reqId = safeId(message.reqId) ?? undefined
  const relayHostId = session.relayHostId
  const fail = (code: string): void => {
    logger.warn('control.request_failed', { relayHostId, type, reqId, code })
    metrics.counter('manta_relay_control_errors_total', 'Control requests refused.', { code })
    reply({ type: 'control-error', reqId, code })
  }

  // Every reply below names its request. The client's schemas require reqId on
  // all of them, so answering without one produces a message it silently
  // discards — and the desktop then waits out its own timeout instead.
  if (!reqId) {
    fail('missing_req_id')
    return true
  }

  if (type === 'invite-create') {
    const relayDeviceId = safeId(message.relayDeviceId)
    if (!relayDeviceId) {
      fail('invalid_device_id')
      return true
    }
    // Each live invite is a credential the cell must remember and check on every
    // phone connect; a desktop stuck in a retry loop must not grow that list.
    if (store.countInvites(relayHostId, now) >= deps.maxLiveInvitesPerHost) {
      fail('too_many_invites')
      return true
    }
    const inviteToken = mintToken()
    // Why cap at 10 minutes: a phone rejects any invite whose expiry is further
    // out than that, so a longer one would simply never scan.
    const expiresAt = now + INVITE_MAX_LIFETIME_MS
    store.putInvite(relayHostId, {
      hash: hashCredential(inviteToken),
      relayDeviceId,
      expiresAt,
      maxAttempts: deps.maxInviteAttempts,
      attempts: 0
    })
    metrics.counter('manta_relay_invites_created_total', 'Invite tokens minted.')
    reply({
      type: 'invite-created',
      reqId,
      inviteToken,
      expiresAt,
      maxAttempts: deps.maxInviteAttempts
    })
    return true
  }

  if (type === 'device-revoke') {
    const relayDeviceId = safeId(message.relayDeviceId) ?? ''
    // Revoking is idempotent from the client's point of view, so an unknown id
    // is still acknowledged — but it must not create a record for that id.
    const revoked = store.revokeDevice(relayHostId, relayDeviceId, now)
    logger.info('device.revoke', { relayHostId, relayDeviceId, known: revoked })
    reply({ type: 'device-revoked', reqId })
    return true
  }

  if (type === 'device-credential-install') {
    const relayDeviceId = safeId(message.relayDeviceId)
    const newHash = str(message.newResumeTokenHash, 128)
    if (!relayDeviceId || !newHash) {
      fail('invalid_install_request')
      return true
    }
    // Idempotency is mandatory: the phone re-reads this result and requires it
    // to be byte-identical, otherwise it aborts the rotation. Scoped by device,
    // because reqId is chosen by the caller and another device's committed
    // rotation must never be replayed as this one's.
    const existing = store.ledgerGet(relayHostId, reqId, relayDeviceId)
    if (existing) {
      reply({ type: 'device-credential-installed', ...existing.result })
      return true
    }
    const authorization = parseInstallAuthorization(message.authorization)
    if (!authorization) {
      fail('invalid_install_authorization')
      return true
    }
    if (authorization.mode === 'relay-basis' && !session.knowsConn(authorization.basisConnId)) {
      // Not fatal — the pairing may have closed between the phone's request and
      // the desktop's install — but it is the signal that would show a desktop
      // rotating credentials with no live pairing behind it.
      logger.warn('install.unknown_basis', {
        relayHostId,
        relayDeviceId,
        connId: authorization.basisConnId
      })
    }
    if (store.ledgerSize(relayHostId) >= deps.maxLedgerEntriesPerHost) {
      fail('ledger_full')
      return true
    }
    const device = store.peekDevice(relayHostId, relayDeviceId)
    const expected = message.expectedCurrentHash
    if (typeof expected === 'string' && device?.current?.hash !== expected) {
      fail('credential_precondition_failed')
      return true
    }
    const installed = store.installCredential(
      relayHostId,
      relayDeviceId,
      newHash,
      deps.resumeTtlMs,
      deps.graceTtlMs,
      now,
      deps.maxDevicesPerHost
    )
    if (!installed) {
      fail('device_limit_reached')
      return true
    }
    const result = {
      v: 1 as const,
      reqId,
      authorizationMode: authorization.mode,
      currentVersion: installed.currentVersion,
      resumeExpiresAt: installed.resumeExpiresAt,
      ...(installed.graceExpiresAt ? { graceExpiresAt: installed.graceExpiresAt } : {})
    }
    store.ledgerPut(relayHostId, reqId, { relayDeviceId, createdAt: now, result })
    metrics.counter('manta_relay_credentials_installed_total', 'Credential rotations committed.', {
      mode: authorization.mode
    })
    logger.info('credential.installed', {
      relayHostId,
      relayDeviceId,
      version: installed.currentVersion,
      mode: authorization.mode
    })
    reply({ type: 'device-credential-installed', ...result })
    return true
  }

  if (type === 'device-credential-install-status') {
    const relayDeviceId = safeId(message.relayDeviceId) ?? ''
    // A ledger entry belongs to one device; leaking another device's credential
    // state would break its rotation schedule.
    const entry = store.ledgerGet(relayHostId, reqId, relayDeviceId)
    reply(
      entry
        ? {
            type: 'device-credential-install-status-result',
            v: 1,
            reqId,
            state: 'committed',
            result: entry.result
          }
        : { type: 'device-credential-install-status-result', v: 1, reqId, state: 'not-found' }
    )
    return true
  }

  if (type === 'device-resume-confirm') {
    // Locate the exact connection this confirmation is about: reporting some
    // other device's version silently breaks that phone's rotation schedule.
    const basisConnId = str(message.basisConnId, 128) ?? ''
    const conn = session.active.get(basisConnId) ?? session.pending.get(basisConnId)
    if (!conn) {
      fail('unknown_device')
      return true
    }
    const device = store.peekDevice(relayHostId, conn.relayDeviceId)
    const acceptedAs = conn.acceptedAs ?? 'current'
    const generation = acceptedAs === 'grace' ? device?.grace : device?.current
    if (!device || !generation) {
      fail('unknown_device')
      return true
    }
    // Sliding renewal, but only for the current generation. Grace is a
    // wind-down, not a second credential: extending it would let a phone sit on
    // a superseded token indefinitely and never finish rotating — and it
    // contradicts the store, which only ever shortens a grace expiry.
    const renewed = acceptedAs === 'current' && generation.expiresAt - now < deps.resumeTtlMs / 2
    if (renewed) {
      generation.expiresAt = now + deps.resumeTtlMs
      store.touch()
    }
    reply({
      type: 'device-resume-confirmed',
      v: 1,
      reqId,
      currentVersion: generation.version,
      acceptedAs,
      renewed,
      resumeExpiresAt: generation.expiresAt,
      ...(device.grace && acceptedAs === 'current'
        ? { graceExpiresAt: device.grace.expiresAt }
        : {})
    })
    return true
  }

  return false
}
