/**
 * Relay accounts.
 *
 * The relay used to serve exactly one identity, read straight from the
 * environment. Multiple people — or one person with several machines they want
 * to keep apart — need real accounts, and every host record and auth session
 * has to say which account it belongs to.
 *
 * The internal key is `accountId`, not `userId`. `userId` is signed
 * byte-for-byte into every host proof, so it belongs to the wire and must never
 * move once a desktop has paired; `accountId` is ours and stays stable even if
 * an operator edits the legacy identity in the environment.
 */
import { randomUUID } from 'node:crypto'
import { JsonFile } from '../shared/json-file.js'

export type AuthAccount = {
  accountId: string
  /** Normalized lookup key: the email, NFKC, lower-cased, trimmed. */
  emailKey: string
  email: string
  displayName: string
  /** The identity triple the desktop signs into its host proof. */
  userId: string
  profileId: string
  organizationId: string
  /** null for the legacy account until an operator sets one. */
  passwordHash: string | null
  createdAt: number
  /** 'legacy' is the account adopted from MANTA_RELAY_USER_* — exactly one. */
  kind: 'legacy' | 'registered'
}

type Snapshot = { v: 1; accounts: AuthAccount[] }

/** A self-hosted relay serves a household or a team, not a public signup. */
const MAX_ACCOUNTS = 256

export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase()
}

/** Deliberately permissive: this is a login handle, not a deliverability check. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]{1,128}@[^\s@]{1,128}\.[^\s@.]{2,63}$/.test(email)
}

export type LegacyIdentity = {
  userId: string
  profileId: string
  organizationId: string
  email: string
  displayName: string
}

function isAccount(value: unknown): value is AuthAccount {
  const account = value as AuthAccount | null
  return (
    typeof account?.accountId === 'string' &&
    typeof account.userId === 'string' &&
    typeof account.profileId === 'string' &&
    typeof account.organizationId === 'string' &&
    typeof account.emailKey === 'string'
  )
}

export class AccountStore {
  private accounts: AuthAccount[] = []
  private readonly file: JsonFile<Snapshot>

  constructor(path: string | null, onError: (error: Error) => void) {
    this.file = new JsonFile<Snapshot>(path, onError)
    const loaded = this.file.read()
    if (loaded?.v === 1 && Array.isArray(loaded.accounts)) {
      this.accounts = loaded.accounts.filter(isAccount)
    }
  }

  private persist(): void {
    this.file.schedule(() => ({ v: 1, accounts: this.accounts }))
  }

  /**
   * Adopts the environment identity as a real account.
   *
   * Must run before anything reads a session: every pre-existing desktop is
   * paired against these exact three strings, and the host proof compares them
   * byte-for-byte, so the legacy account has to keep serving them forever.
   */
  bootstrapLegacy(identity: LegacyIdentity, now: number): AuthAccount {
    const existing = this.accounts.find((account) => account.kind === 'legacy')
    const emailKey = normalizeEmail(identity.email)
    if (!existing) {
      const account: AuthAccount = {
        accountId: `acct-${randomUUID()}`,
        emailKey,
        email: identity.email,
        displayName: identity.displayName,
        userId: identity.userId,
        profileId: identity.profileId,
        organizationId: identity.organizationId,
        passwordHash: null,
        createdAt: now,
        kind: 'legacy'
      }
      this.accounts.push(account)
      this.persist()
      return account
    }
    // The identity triple is signed byte-for-byte into every host proof, so a
    // desktop that paired under the old one can never prove itself again — a
    // 4401 with nothing in either log to explain it. Refusing to start is the
    // only outcome that gets a person to look, and it is recoverable: put the
    // value back, or edit auth-accounts.json deliberately.
    //
    // The trap this exists for is not a deliberate edit. It is an env_file that
    // moved, or a compose file rewritten without MANTA_RELAY_USER_ID — where
    // the variable silently becomes its default and every pairing dies.
    if (
      existing.userId !== identity.userId ||
      existing.profileId !== identity.profileId ||
      existing.organizationId !== identity.organizationId
    ) {
      throw new Error(
        'the stored identity for the legacy account does not match the environment:\n' +
          `  - MANTA_RELAY_USER_ID: stored ${existing.userId}, configured ${identity.userId}\n` +
          `  - MANTA_RELAY_PROFILE_ID: stored ${existing.profileId}, configured ${identity.profileId}\n` +
          `  - MANTA_RELAY_ORG_ID: stored "${existing.organizationId}", configured "${identity.organizationId}"\n` +
          'Every desktop paired under the stored values signs them into its host proof, so\n' +
          'changing them breaks pairing with no diagnostic. Restore them, or edit\n' +
          'auth-accounts.json if the change is deliberate.'
      )
    }
    // Cosmetic fields stay environment-driven; nothing is signed with them.
    existing.displayName = identity.displayName
    const collision = this.accounts.find(
      (account) => account !== existing && account.emailKey === emailKey
    )
    if (!collision) {
      existing.email = identity.email
      existing.emailKey = emailKey
    }
    this.persist()
    return existing
  }

  byId(accountId: string): AuthAccount | null {
    return this.accounts.find((account) => account.accountId === accountId) ?? null
  }

  byEmail(email: string): AuthAccount | null {
    const key = normalizeEmail(email)
    return this.accounts.find((account) => account.emailKey === key) ?? null
  }

  get size(): number {
    return this.accounts.length
  }

  get atCapacity(): boolean {
    return this.accounts.length >= MAX_ACCOUNTS
  }

  /**
   * Creates an account.
   *
   * `userId` is minted here and never derived from the email: it is signed into
   * every host proof, so it must survive the user changing their address.
   */
  create(input: {
    email: string
    displayName: string
    passwordHash: string
    now: number
  }): AuthAccount | null {
    if (this.atCapacity || this.byEmail(input.email)) {
      return null
    }
    const id = randomUUID()
    const account: AuthAccount = {
      accountId: `acct-${id}`,
      emailKey: normalizeEmail(input.email),
      email: input.email.trim(),
      displayName: input.displayName.trim() || input.email.trim(),
      userId: `user-${id}`,
      profileId: `profile-${id}`,
      // Empty, never omitted: the relay token carries it verbatim and the
      // desktop compares it byte-for-byte.
      organizationId: '',
      passwordHash: input.passwordHash,
      createdAt: input.now,
      kind: 'registered'
    }
    this.accounts.push(account)
    this.persist()
    return account
  }

  setPassword(accountId: string, passwordHash: string): boolean {
    const account = this.byId(accountId)
    if (!account) {
      return false
    }
    account.passwordHash = passwordHash
    this.persist()
    return true
  }

  flush(): void {
    this.file.stop()
  }
}
