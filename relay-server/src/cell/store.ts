/**
 * Cell state: the credential authority.
 *
 * A cell is not a dumb pipe. It owns device credentials (two generations, with
 * versions), invite tokens, and the idempotency ledger for credential installs.
 * The phone treats this server as authoritative, so state must survive restarts.
 */
import { join } from 'node:path'
import { hashCredential } from '../shared/protocol.js'
import { JsonFile } from '../shared/json-file.js'
import { safeId } from '../shared/wire.js'
import type {
  CredentialGeneration,
  DeviceRecord,
  HostRecord,
  InstallLedgerEntry,
  InviteRecord,
  StoredHost
} from './store-records.js'

export type {
  CredentialGeneration,
  DeviceRecord,
  HostRecord,
  InstallLedgerEntry,
  InviteRecord
} from './store-records.js'

type Snapshot = { v: 1; hosts: Record<string, StoredHost> }

/**
 * Rebuilds a Map from a snapshot object.
 *
 * `Object.entries` skips inherited keys, but a snapshot written by an older
 * build could still carry a literal "__proto__" entry, and reading it back into
 * a Map is the safe place to drop it.
 */
function toMap<T>(source: Record<string, T> | undefined): Map<string, T> {
  const out = new Map<string, T>()
  for (const [key, value] of Object.entries(source ?? {})) {
    if (key !== '__proto__' && value) {
      out.set(key, value)
    }
  }
  return out
}

/** How long an empty host record is kept before it is considered abandoned. */
const IDLE_HOST_TTL_MS = 24 * 60 * 60_000
/** A rotation round-trip is seconds; a day of history is already generous. */
const LEDGER_TTL_MS = 24 * 60 * 60_000

export class CellStore {
  private readonly hosts = new Map<string, HostRecord>()
  /** Version high-water marks kept for hosts whose records have been swept. */
  private readonly versionFloor = new Map<string, number>()
  private readonly file: JsonFile<Snapshot>

  constructor(
    dataDir: string | null,
    onError: (error: Error) => void = () => {
      // A failed write is surfaced by the caller's logger in production; the
      // default keeps tests silent.
    }
  ) {
    this.file = new JsonFile<Snapshot>(dataDir ? join(dataDir, 'cell-state.json') : null, onError)
    const loaded = this.file.read()
    if (loaded?.v === 1 && loaded.hosts) {
      for (const [id, host] of Object.entries(loaded.hosts)) {
        if (id === '__proto__' || !host) {
          continue
        }
        this.hosts.set(id, {
          ...host,
          devices: toMap(host.devices),
          invites: toMap(host.invites),
          installLedger: toMap(host.installLedger)
        })
      }
    }
  }

  private scheduleFlush(): void {
    this.file.schedule(() => ({
      v: 1,
      hosts: Object.fromEntries(
        [...this.hosts].map(([id, host]) => [
          id,
          {
            ...host,
            devices: Object.fromEntries(host.devices),
            invites: Object.fromEntries(host.invites),
            installLedger: Object.fromEntries(host.installLedger)
          }
        ])
      )
    }))
  }

  flush(): void {
    this.file.stop()
  }

  /** Marks state dirty after an in-place mutation of a returned record. */
  touch(): void {
    this.scheduleFlush()
  }

  host(relayHostId: string): HostRecord {
    let record = this.hosts.get(relayHostId)
    if (!record) {
      record = {
        relayHostId,
        devices: new Map(),
        invites: new Map(),
        installLedger: new Map(),
        generation: 0
      }
      this.hosts.set(relayHostId, record)
    }
    return record
  }

  /** Reads a host without creating one, for paths a stranger can reach. */
  peekHost(relayHostId: string): HostRecord | undefined {
    return this.hosts.get(relayHostId)
  }

  nextGeneration(relayHostId: string): number {
    const host = this.host(relayHostId)
    host.generation += 1
    this.scheduleFlush()
    return host.generation
  }

  markSeen(relayHostId: string, now: number): void {
    this.host(relayHostId).lastSeenAt = now
    this.scheduleFlush()
  }

  putInvite(relayHostId: string, invite: InviteRecord): void {
    this.host(relayHostId).invites.set(invite.hash, invite)
    this.scheduleFlush()
  }

  /** Live invites for a host; used to cap how many can be outstanding. */
  countInvites(relayHostId: string, now: number): number {
    const host = this.hosts.get(relayHostId)
    if (!host) {
      return 0
    }
    return [...host.invites.values()].filter(
      (invite) => invite.expiresAt > now && invite.attempts < invite.maxAttempts
    ).length
  }

  /**
   * Looks up a live invite. Attempts are only charged on a *successful* match,
   * so a stranger probing with random tokens cannot burn a legitimate QR code.
   */
  takeInvite(relayHostId: string, token: string, now: number): InviteRecord | null {
    const host = this.hosts.get(relayHostId)
    if (!host) {
      return null
    }
    const invite = host.invites.get(hashCredential(token))
    if (!invite || invite.expiresAt <= now || invite.attempts >= invite.maxAttempts) {
      return null
    }
    invite.attempts += 1
    this.scheduleFlush()
    return invite
  }

  /** Retires an invite once a device has actually used it. */
  consumeInvite(relayHostId: string, token: string): void {
    const host = this.hosts.get(relayHostId)
    if (host) {
      host.invites.delete(hashCredential(token))
      this.scheduleFlush()
    }
  }

  device(relayHostId: string, relayDeviceId: string): DeviceRecord | undefined {
    // An id that is not a plain identifier never becomes a key. The Map already
    // removes the prototype hazard; this keeps the snapshot readable and bounds
    // what a host can write into it.
    if (!safeId(relayDeviceId)) {
      return undefined
    }
    const host = this.host(relayHostId)
    let device = host.devices.get(relayDeviceId)
    if (!device) {
      device = { relayDeviceId }
      host.devices.set(relayDeviceId, device)
    }
    return device
  }

  /** Reads a device without creating one. */
  peekDevice(relayHostId: string, relayDeviceId: string): DeviceRecord | undefined {
    return this.hosts.get(relayHostId)?.devices.get(relayDeviceId)
  }

  /** Devices that still hold a usable credential. */
  countDevices(relayHostId: string): number {
    const host = this.hosts.get(relayHostId)
    if (!host) {
      return 0
    }
    // Only devices holding a usable credential count against the ceiling: a
    // revoked husk must not reserve a slot, and must not exempt itself from the
    // check by merely existing.
    return [...host.devices.values()].filter(
      (device) => !device.revokedAt && (device.current !== undefined || device.grace !== undefined)
    ).length
  }

  /**
   * Resolves a resume token to the generation that accepted it. The phone only
   * falls back to its grace copy after a 4401, so both must stay acceptable.
   */
  matchResume(
    relayHostId: string,
    token: string,
    now: number
  ): {
    device: DeviceRecord
    acceptedAs: 'current' | 'grace'
    generation: CredentialGeneration
  } | null {
    const hash = hashCredential(token)
    const host = this.hosts.get(relayHostId)
    if (!host) {
      return null
    }
    for (const device of host.devices.values()) {
      if (device.revokedAt) {
        continue
      }
      if (device.current?.hash === hash && device.current.expiresAt > now) {
        return { device, acceptedAs: 'current', generation: device.current }
      }
      if (device.grace?.hash === hash && device.grace.expiresAt > now) {
        return { device, acceptedAs: 'grace', generation: device.grace }
      }
    }
    return null
  }

  /**
   * Installs a new credential generation.
   *
   * Returns null when the host is already at its device ceiling and this would
   * be a new device — refusing is the only bound on how much state one host can
   * make the cell keep.
   */
  installCredential(
    relayHostId: string,
    relayDeviceId: string,
    newHash: string,
    resumeTtlMs: number,
    graceTtlMs: number,
    now: number,
    maxDevices: number
  ): { currentVersion: number; resumeExpiresAt: number; graceExpiresAt?: number } | null {
    if (!safeId(relayDeviceId)) {
      return null
    }
    const host = this.host(relayHostId)
    const known = host.devices.get(relayDeviceId)
    // A revoked or emptied record must not exempt itself from the ceiling by
    // existing — reviving it is exactly how the limit was bypassed.
    const holdsCredential = known?.current !== undefined || known?.grace !== undefined
    if (!holdsCredential && this.countDevices(relayHostId) >= maxDevices) {
      return null
    }
    const device = this.device(relayHostId, relayDeviceId)
    if (!device) {
      return null
    }
    const previous = device.current
    const version =
      Math.max(
        host.maxCredentialVersion ?? 0,
        this.versionFloor.get(relayHostId) ?? 0,
        previous?.version ?? 0
      ) + 1
    host.maxCredentialVersion = version
    // Why keep the old generation: the phone may still be holding it while it
    // finishes rotating. Its expiry is only ever shortened, never extended —
    // the grace window is a wind-down, not a renewal.
    device.grace = previous
      ? { ...previous, expiresAt: Math.min(previous.expiresAt, now + graceTtlMs) }
      : undefined
    device.current = { hash: newHash, version, expiresAt: now + resumeTtlMs }
    delete device.revokedAt
    this.scheduleFlush()
    return {
      currentVersion: version,
      resumeExpiresAt: device.current.expiresAt,
      graceExpiresAt: device.grace?.expiresAt
    }
  }

  /** Revoking an id we have never seen must not conjure a record for it. */
  revokeDevice(relayHostId: string, relayDeviceId: string, now: number): boolean {
    if (!safeId(relayDeviceId)) {
      return false
    }
    const device = this.peekDevice(relayHostId, relayDeviceId)
    if (!device) {
      return false
    }
    device.revokedAt = now
    delete device.current
    delete device.grace
    this.scheduleFlush()
    return true
  }

  /**
   * Looks up a committed install.
   *
   * Scoped by device, like the status endpoint already was: a reqId is chosen
   * by the caller, so an entry belonging to another device must never be
   * replayed as this one's result.
   */
  ledgerGet(
    relayHostId: string,
    reqId: string,
    relayDeviceId?: string
  ): InstallLedgerEntry | undefined {
    const entry = this.hosts.get(relayHostId)?.installLedger.get(reqId)
    if (!entry) {
      return undefined
    }
    return relayDeviceId === undefined || entry.relayDeviceId === relayDeviceId ? entry : undefined
  }

  ledgerSize(relayHostId: string): number {
    return this.hosts.get(relayHostId)?.installLedger.size ?? 0
  }

  ledgerPut(relayHostId: string, reqId: string, entry: InstallLedgerEntry): void {
    this.host(relayHostId).installLedger.set(reqId, entry)
    this.scheduleFlush()
  }

  /** Drops expired invites, credentials, ledger entries, and idle host records. */
  sweep(now: number): void {
    for (const [hostId, host] of this.hosts) {
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
        // An entry with no timestamp cannot be aged, so it is dropped rather
        // than kept forever; a rotation round-trip is seconds, and the client
        // retries with a fresh reqId.
        if (typeof entry.createdAt !== 'number' || now - entry.createdAt > LEDGER_TTL_MS) {
          host.installLedger.delete(reqId)
        }
      }
      // An empty record still costs memory and a snapshot entry. Only retire it
      // once it has also been quiet: dropping a live host's resume secret would
      // turn its next lease rebind into a full reconnect.
      const empty =
        host.devices.size === 0 && host.invites.size === 0 && host.installLedger.size === 0
      if (empty && now - (host.lastSeenAt ?? 0) > IDLE_HOST_TTL_MS) {
        // Keep the version high-water mark. A phone refuses a credential
        // version it has already seen, so restarting the numbering after the
        // record is gone would make it reject the very credential it was just
        // handed on re-pairing.
        this.versionFloor.set(hostId, host.maxCredentialVersion ?? 0)
        this.hosts.delete(hostId)
      }
    }
    this.scheduleFlush()
  }

  get hostCount(): number {
    return this.hosts.size
  }
}
