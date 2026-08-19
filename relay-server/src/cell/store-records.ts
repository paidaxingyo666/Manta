/**
 * The shapes the credential store persists.
 *
 * Separated from the store's behaviour so the record layout can be read on its
 * own — it is the part that has to stay compatible across restarts.
 */

export type CredentialGeneration = {
  /** base64url(SHA256(utf8(token))) — never the raw token. */
  hash: string
  /** Monotonic, positive. The phone compares this against its local copy. */
  version: number
  expiresAt: number
}

export type DeviceRecord = {
  relayDeviceId: string
  current?: CredentialGeneration
  /** Kept alive so a phone mid-rotation can still attach with the old token. */
  grace?: CredentialGeneration
  revokedAt?: number
}

export type InviteRecord = {
  hash: string
  relayDeviceId: string
  expiresAt: number
  maxAttempts: number
  attempts: number
}

export type InstallLedgerEntry = {
  /** Scopes the entry so one device cannot read another's rotation state. */
  relayDeviceId: string
  /**
   * When the entry was written.
   *
   * Sweeping on the credential's own expiry does not work: a resume credential
   * lives 90 days, so every ledger entry would outlive the rotation it records
   * and the ledger would grow without bound.
   */
  createdAt: number
  /** Stored verbatim so a repeated request replays a byte-identical result. */
  result: {
    v: 1
    reqId: string
    authorizationMode: string
    currentVersion: number
    resumeExpiresAt: number
    graceExpiresAt?: number
  }
}

/**
 * Live host state.
 *
 * Maps, not plain objects, and deliberately so. Every key here comes off the
 * wire, and `devices['__proto__']` on a plain object resolves to
 * `Object.prototype` — so `revokeDevice(hostId, '__proto__')` would write
 * `revokedAt` onto the prototype every other record inherits from, making every
 * device on every host look revoked and handing each phone a 4401. A Map has no
 * prototype chain to reach, which removes the whole class rather than one name.
 */
export type HostRecord = {
  relayHostId: string
  devices: Map<string, DeviceRecord>
  invites: Map<string, InviteRecord>
  /** Keyed by reqId. The phone re-reads this to confirm a rotation committed. */
  installLedger: Map<string, InstallLedgerEntry>
  generation: number
  /**
   * Digest of the secret a rebind must present, never the secret itself.
   *
   * The cell only ever *compares* this value, so there is no reason for the
   * state file — the most attractive thing on the host — to hold something
   * directly replayable.
   */
  controlResumeSecretHash?: string
  /**
   * Highest credential version ever issued to any device on this host.
   *
   * Versions must never go backwards: a phone rejects a credential whose version
   * it has already seen, so restarting from 1 after a revoke or a sweep would
   * make it refuse the very credential it was just handed.
   */
  maxCredentialVersion?: number
  /** Last successful control handshake; only idle empty hosts are swept. */
  lastSeenAt?: number
}

/** Maps do not survive JSON, so the snapshot uses plain objects. */
export type StoredHost = Omit<HostRecord, 'devices' | 'invites' | 'installLedger'> & {
  devices: Record<string, DeviceRecord>
  invites: Record<string, InviteRecord>
  installLedger: Record<string, InstallLedgerEntry>
}
