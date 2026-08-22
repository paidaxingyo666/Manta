/**
 * Which account a host belongs to.
 *
 * Kept out of the store because it is a different question: the store is the
 * credential authority for one host, while this is the map from an account to
 * the machines it owns — the thing a user reads when they want to reach their
 * other computer.
 */
import type { HostDescriptor, HostRecord } from './store-records.js'

export type HostClaimResult = 'ok' | 'owned-by-other' | 'at-capacity'

type OwnershipDeps = {
  hosts: Map<string, HostRecord>
  /** Creates the record if it does not exist yet. */
  ensureHost: (relayHostId: string) => HostRecord
  /** Preserves the credential version high-water mark before a record is dropped. */
  retire: (relayHostId: string, host: HostRecord) => void
  flush: () => void
}

export class HostOwnerIndex {
  private readonly byAccount = new Map<string, Set<string>>()

  constructor(private readonly deps: OwnershipDeps) {}

  add(relayHostId: string, ownerAccountId: string | undefined): void {
    if (!ownerAccountId) {
      return
    }
    let set = this.byAccount.get(ownerAccountId)
    if (!set) {
      set = new Set()
      this.byAccount.set(ownerAccountId, set)
    }
    set.add(relayHostId)
  }

  remove(relayHostId: string, ownerAccountId: string | undefined): void {
    if (!ownerAccountId) {
      return
    }
    const set = this.byAccount.get(ownerAccountId)
    set?.delete(relayHostId)
    if (set?.size === 0) {
      this.byAccount.delete(ownerAccountId)
    }
  }

  /**
   * Binds a host id to an account, or confirms it is already theirs.
   *
   * First use claims it. A host id is a digest of the desktop's public key, so
   * nobody can guess another user's — but once claimed, refusing everyone else
   * is what makes a stolen or shared relay token useless against it.
   */
  claim(relayHostId: string, accountId: string, maxHostsPerAccount: number): HostClaimResult {
    const existing = this.deps.hosts.get(relayHostId)
    if (existing?.ownerAccountId) {
      return existing.ownerAccountId === accountId ? 'ok' : 'owned-by-other'
    }
    if ((this.byAccount.get(accountId)?.size ?? 0) >= maxHostsPerAccount) {
      return 'at-capacity'
    }
    const host = this.deps.ensureHost(relayHostId)
    host.ownerAccountId = accountId
    this.add(relayHostId, accountId)
    this.deps.flush()
    return 'ok'
  }

  /**
   * Moves a host from one account to another.
   *
   * Only ever used to hand a machine that the legacy account inherited to the
   * real person who owns it: on a relay that predates accounts every host
   * belongs to the environment identity, and the operator who then registers an
   * account of their own would otherwise be locked out of their own desktop.
   */
  transfer(
    relayHostId: string,
    fromAccountId: string,
    toAccountId: string,
    maxHostsPerAccount: number
  ): HostClaimResult {
    const host = this.deps.hosts.get(relayHostId)
    if (!host || host.ownerAccountId !== fromAccountId) {
      return host?.ownerAccountId === toAccountId ? 'ok' : 'owned-by-other'
    }
    if ((this.byAccount.get(toAccountId)?.size ?? 0) >= maxHostsPerAccount) {
      return 'at-capacity'
    }
    this.remove(relayHostId, fromAccountId)
    host.ownerAccountId = toAccountId
    this.add(relayHostId, toAccountId)
    this.deps.flush()
    return 'ok'
  }

  ownerOf(relayHostId: string): string | undefined {
    return this.deps.hosts.get(relayHostId)?.ownerAccountId
  }

  /** The account's machines, most recent contact first. */
  listFor(accountId: string): HostRecord[] {
    const ids = this.byAccount.get(accountId)
    if (!ids) {
      return []
    }
    return [...ids]
      .map((id) => this.deps.hosts.get(id))
      .filter((host): host is HostRecord => host !== undefined)
      .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
  }

  /** Records what a desktop calls itself. Cosmetic; nothing routes on it. */
  describe(relayHostId: string, descriptor: HostDescriptor): void {
    this.deps.ensureHost(relayHostId).descriptor = descriptor
    this.deps.flush()
  }

  /**
   * Drops a machine and everything paired to it.
   *
   * The version high-water mark stays behind: a phone refuses a credential
   * version it has already seen, so a host that is later re-paired must not
   * restart the numbering.
   */
  release(relayHostId: string, accountId: string): boolean {
    const host = this.deps.hosts.get(relayHostId)
    if (!host || host.ownerAccountId !== accountId) {
      return false
    }
    this.deps.retire(relayHostId, host)
    this.deps.hosts.delete(relayHostId)
    this.remove(relayHostId, accountId)
    this.deps.flush()
    return true
  }
}
