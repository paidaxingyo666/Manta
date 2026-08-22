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
  /**
   * Preserves the credential version high-water mark before a record is
   * dropped. Never downwards: a phone refuses a version it has already seen, so
   * a floor that regressed is a 4401 the re-paired device cannot recover from.
   */
  retire: (relayHostId: string, host: HostRecord) => void
  flush: () => void
  now: () => number
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
    // Claiming is contact from the owner, so it counts as being seen. Without
    // this the record ages from zero and the sweeper retires it on its next
    // pass — deleting the machine from its owner's list about a minute after
    // they signed in, which is exactly the machine they are looking for.
    host.lastSeenAt = this.deps.now()
    this.add(relayHostId, accountId)
    this.deps.flush()
    return 'ok'
  }

  /**
   * Moves a host to the account asking for it.
   *
   * Two sources, both of them "nobody is actually holding this":
   *
   *   the legacy account — on a relay that predates accounts every host belongs
   *   to the environment identity, so the operator who registers an account of
   *   their own would be locked out of their own desktop
   *
   *   an account that no longer exists — if auth-accounts.json is lost or
   *   quarantined, the legacy account is rebuilt with a fresh id and every host
   *   record still names the old one. Without this, all of them are orphaned
   *   with no way back short of hand-editing cell-state.json
   *
   * Never from a live account: the enrolment secret is a deployment credential,
   * not a master key over other people's machines.
   */
  transfer(
    relayHostId: string,
    fromAccountId: string,
    toAccountId: string,
    maxHostsPerAccount: number,
    accountExists: (accountId: string) => boolean
  ): HostClaimResult {
    const host = this.deps.hosts.get(relayHostId)
    const owner = host?.ownerAccountId
    if (!host || (owner !== fromAccountId && owner !== undefined && accountExists(owner))) {
      return owner === toAccountId ? 'ok' : 'owned-by-other'
    }
    if ((this.byAccount.get(toAccountId)?.size ?? 0) >= maxHostsPerAccount) {
      return 'at-capacity'
    }
    this.remove(relayHostId, owner)
    host.ownerAccountId = toAccountId
    host.lastSeenAt = this.deps.now()
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
    const host = this.deps.ensureHost(relayHostId)
    host.descriptor = descriptor
    host.lastSeenAt = this.deps.now()
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
