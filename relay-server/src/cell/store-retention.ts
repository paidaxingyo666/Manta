/**
 * What the cell forgets, and when.
 *
 * Two clocks, because two things are being kept. A device's credential is kept
 * until it expires. A *host record* is kept because someone still cares about
 * it: an unowned one is scratch space from a handshake, while an owned one is
 * a line in its owner's machine list and has to outlive a laptop that spent a
 * fortnight in a bag.
 */
import type { HostRecord } from './store-records.js'

/** An unowned record is scratch space; nothing points at it. */
const IDLE_HOST_TTL_MS = 24 * 60 * 60_000
/**
 * An owned record is also the owner's machine-list entry. Growth is already
 * bounded by the per-account host cap, so the only job left here is retiring a
 * machine the user really has retired.
 */
const OWNED_HOST_TTL_MS = 90 * 24 * 60 * 60_000
/** A rotation round-trip is seconds; a day of history is already generous. */
const LEDGER_TTL_MS = 24 * 60 * 60_000

/** Drops what has expired inside one host, and says whether it is now empty. */
export function sweepHostContents(host: HostRecord, now: number): boolean {
  for (const [hash, invite] of host.invites) {
    if (invite.expiresAt <= now || invite.attempts >= invite.maxAttempts) {
      host.invites.delete(hash)
    }
  }
  for (const [id, device] of host.devices) {
    if (device.current && device.current.expiresAt <= now) {
      delete device.current
    }
    if (device.grace && device.grace.expiresAt <= now) {
      delete device.grace
    }
    // Drop devices that hold nothing; maxCredentialVersion on the host keeps
    // version numbers monotonic even after the record is gone.
    if (!device.current && !device.grace) {
      host.devices.delete(id)
    }
  }
  for (const [reqId, entry] of host.installLedger) {
    // An entry with no timestamp cannot be aged, so it is dropped rather than
    // kept for ever; a rotation round-trip is seconds and the client retries
    // with a fresh reqId.
    if (typeof entry.createdAt !== 'number' || now - entry.createdAt > LEDGER_TTL_MS) {
      host.installLedger.delete(reqId)
    }
  }
  return host.devices.size === 0 && host.invites.size === 0 && host.installLedger.size === 0
}

/**
 * Whether an empty record has also been quiet long enough to retire.
 *
 * `lastSeenAt` is stamped by every contact from the owner — claiming, being
 * described, a control handshake. A record that has never been contacted at
 * all is the one case where zero is honest.
 */
export function hostIsAbandoned(host: HostRecord, now: number): boolean {
  const ttl = host.ownerAccountId ? OWNED_HOST_TTL_MS : IDLE_HOST_TTL_MS
  return now - (host.lastSeenAt ?? 0) > ttl
}
