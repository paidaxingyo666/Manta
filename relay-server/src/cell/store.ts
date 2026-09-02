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
import { hostFromSnapshot, hostToSnapshot } from './store-records.js'
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
  HostDescriptor,
  HostRecord,
  InstallLedgerEntry,
  InviteRecord
} from './store-records.js'

import { HostOwnerIndex } from './host-ownership.js'
import { hostIsAbandoned, sweepHostContents } from './store-retention.js'

export type { HostClaimResult } from './host-ownership.js'

type Snapshot = { v: 1; hosts: Record<string, StoredHost> }

export class CellStore {
  private readonly hosts = new Map<string, HostRecord>()
  /** Version high-water marks kept for hosts whose records have been swept. */
  private readonly versionFloor = new Map<string, number>()
  /** Reverse index for the owner's machine list; rebuilt from the snapshot. */
  readonly ownership = new HostOwnerIndex({
    hosts: this.hosts,
    ensureHost: (id) => this.host(id),
    retire: (id, host) => this.rememberVersionFloor(id, host.maxCredentialVersion ?? 0),
    flush: () => this.scheduleFlush(),
    now: () => Date.now()
  })
  private readonly file: JsonFile<Snapshot>

  /**
   * @param legacyAccountId Adopts host records written before accounts existed.
   *   Leaving them unowned would let the first account that asked claim someone
   *   else's already-paired host.
   */
  constructor(
    dataDir: string | null,
    onError: (error: Error) => void = () => {
      // A failed write is surfaced by the caller's logger in production; the
      // default keeps tests silent.
    },
    legacyAccountId = ''
  ) {
    this.file = new JsonFile<Snapshot>(dataDir ? join(dataDir, 'cell-state.json') : null, onError)
    const loaded = this.file.read()
    if (loaded?.v === 1 && loaded.hosts) {
      for (const [id, host] of Object.entries(loaded.hosts)) {
        if (id === '__proto__' || !host) {
          continue
        }
        const ownerAccountId = host.ownerAccountId || legacyAccountId || undefined
        this.hosts.set(id, hostFromSnapshot(host, ownerAccountId))
        this.ownership.add(id, ownerAccountId)
      }
    }
  }

  /**
   * Never downwards, and never zero.
   *
   * Downwards is a 4401 the re-paired device cannot recover from (see `retire`
   * in host-ownership.ts). Zero protects nothing, and a host that never issued
   * a credential is exactly what a claim/forget loop produces — an
   * authenticated way to grow this map without bound.
   */
  private rememberVersionFloor(relayHostId: string, version: number): void {
    const floor = Math.max(this.versionFloor.get(relayHostId) ?? 0, version)
    if (floor > 0) {
      this.versionFloor.set(relayHostId, floor)
    }
  }

  private scheduleFlush(): void {
    this.file.schedule(() => ({
      v: 1,
      hosts: Object.fromEntries([...this.hosts].map(([id, host]) => [id, hostToSnapshot(host)]))
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
      if (!sweepHostContents(host, now) || !hostIsAbandoned(host, now)) {
        continue
      }
      this.rememberVersionFloor(hostId, host.maxCredentialVersion ?? 0)
      this.hosts.delete(hostId)
      this.ownership.remove(hostId, host.ownerAccountId)
    }
    this.scheduleFlush()
  }

  get hostCount(): number {
    return this.hosts.size
  }

  /** Exposed so a test can prove the floor map is not an unbounded sink. */
  get versionFloorSize(): number {
    return this.versionFloor.size
  }
}
