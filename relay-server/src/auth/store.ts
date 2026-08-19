/**
 * Persistent auth sessions.
 *
 * Holding these only in memory looks harmless until the relay restarts: the
 * desktop's access token stops resolving, every call 401s, and the user has to
 * sign in again through a browser — on a box that reboots for updates, that is
 * a nightly outage of the whole relay path.
 *
 * Tokens are stored hashed. The file is the single most attractive thing on the
 * host, and a snapshot of it should not be directly replayable as a bearer.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { JsonFile } from '../shared/json-file.js'

export type AuthSession = {
  /** SHA-256 of the access token, base64url. */
  accessHash: string
  refreshHash: string
  expiresAt: number
  createdAt: number
}

type Snapshot = { v: 1; sessions: AuthSession[] }

/** Bounds the file: a client that never logs out still cannot grow it forever. */
const MAX_SESSIONS = 64

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

export class AuthSessionStore {
  private sessions: AuthSession[] = []
  private readonly file: JsonFile<Snapshot>

  constructor(path: string | null, onError: (error: Error) => void) {
    this.file = new JsonFile<Snapshot>(path, onError)
    const loaded = this.file.read()
    if (loaded?.v === 1 && Array.isArray(loaded.sessions)) {
      this.sessions = loaded.sessions.filter(
        (session) =>
          typeof session?.accessHash === 'string' &&
          typeof session?.refreshHash === 'string' &&
          typeof session?.expiresAt === 'number'
      )
    }
  }

  private persist(): void {
    this.file.schedule(() => ({ v: 1, sessions: this.sessions }))
  }

  /** Mints a session and returns the plaintext tokens exactly once. */
  create(
    ttlMs: number,
    now: number
  ): { accessToken: string; refreshToken: string; expiresAt: number } {
    const accessToken = `access-${randomUUID()}`
    const refreshToken = `refresh-${randomUUID()}`
    const expiresAt = now + ttlMs
    this.sessions.push({
      accessHash: hashToken(accessToken),
      refreshHash: hashToken(refreshToken),
      expiresAt,
      createdAt: now
    })
    this.prune(now)
    this.persist()
    return { accessToken, refreshToken, expiresAt }
  }

  findByAccess(token: string, now: number): AuthSession | null {
    const hash = hashToken(token)
    return this.sessions.find((s) => s.expiresAt > now && equal(s.accessHash, hash)) ?? null
  }

  findByRefresh(token: string, now: number): AuthSession | null {
    const hash = hashToken(token)
    return this.sessions.find((s) => s.expiresAt > now && equal(s.refreshHash, hash)) ?? null
  }

  remove(session: AuthSession): void {
    this.sessions = this.sessions.filter((candidate) => candidate !== session)
    this.persist()
  }

  /** Drops expired sessions, then the oldest ones once over the cap. */
  prune(now: number): void {
    this.sessions = this.sessions.filter((session) => session.expiresAt > now)
    if (this.sessions.length > MAX_SESSIONS) {
      this.sessions.sort((a, b) => a.createdAt - b.createdAt)
      this.sessions = this.sessions.slice(this.sessions.length - MAX_SESSIONS)
    }
    this.persist()
  }

  get size(): number {
    return this.sessions.length
  }

  flush(): void {
    this.file.stop()
  }
}
