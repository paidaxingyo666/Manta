/**
 * Artifact metadata and bodies.
 *
 * Two stores in one, because they have different failure modes: the index is a
 * small document that must never be observed half-written (JsonFile handles
 * that), while a body is up to ten megabytes and has no business in a snapshot
 * that is rewritten on every mutation. Bodies are files named by slug; the
 * index is the only thing that says which of them exist.
 *
 * The index therefore leads on create and trails on delete: a body with no
 * index entry is unreachable garbage the sweep collects, whereas an index entry
 * with no body is a 404 on a link someone has already shared.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { JsonFile } from '../shared/json-file.js'

export type ArtifactContentType = 'text/html' | 'text/markdown'

export type ArtifactRecord = {
  slug: string
  accountId: string
  title: string | null
  originalFileName: string | null
  sourceContentType: ArtifactContentType
  createdAt: number
  updatedAt: number
  expiresAt: number
  /** Bytes of the source the publisher sent, which is what its limits count. */
  byteSize: number
  /** Ties a replayed create to the artifact the lost response created. */
  idempotencyKey: string | null
}

type Snapshot = { v: 1; artifacts: ArtifactRecord[] }

export type ArtifactQuota = {
  maxPerAccount: number
  maxTotalBytesPerAccount: number
}

/** What a create or update needs, minus everything the store decides itself. */
export type ArtifactWrite = {
  accountId: string
  title: string | null
  originalFileName: string | null
  sourceContentType: ArtifactContentType
  byteSize: number
  html: string
  ttlMs: number
}

export type QuotaFailure = { reason: 'too_many' | 'too_large' }

/**
 * The edit token for a slug, derived rather than stored.
 *
 * A create whose response is lost is retried with the same idempotency key, and
 * the desktop needs the *same* edit token back or it can never finish the
 * publish — so the token has to be reproducible. Deriving it keeps it out of
 * the index at rest, which storing it to answer that replay would not.
 */
function deriveEditToken(secret: string, slug: string): string {
  return createHmac('sha256', secret).update(`artifact-edit:${slug}`).digest('base64url')
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

function wellFormed(record: Partial<ArtifactRecord> | null): boolean {
  return (
    typeof record?.slug === 'string' &&
    typeof record.accountId === 'string' &&
    typeof record.expiresAt === 'number' &&
    typeof record.byteSize === 'number'
  )
}

export class ArtifactStore {
  private records: ArtifactRecord[] = []
  private readonly file: JsonFile<Snapshot>
  private readonly bodyDir: string | null

  constructor(
    dataDir: string | null,
    private readonly onError: (error: Error) => void,
    private readonly quota: ArtifactQuota,
    private readonly editSecret: string
  ) {
    this.bodyDir = dataDir ? join(dataDir, 'artifacts', 'bodies') : null
    this.file = new JsonFile<Snapshot>(
      dataDir ? join(dataDir, 'artifacts', 'index.json') : null,
      onError
    )
    const snapshot = this.file.read()
    this.records = (snapshot?.artifacts ?? []).filter(wellFormed)
  }

  get size(): number {
    return this.records.length
  }

  get totalBytes(): number {
    return this.records.reduce((sum, record) => sum + record.byteSize, 0)
  }

  /**
   * Live records for an account, newest first.
   *
   * Expiry is applied on read rather than only by the sweep, so a link stops
   * working when it says it does even if nothing has swept yet.
   */
  list(accountId: string, now: number): ArtifactRecord[] {
    return this.records
      .filter((record) => record.accountId === accountId && record.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  find(slug: string, now: number): ArtifactRecord | null {
    return this.records.find((r) => r.slug === slug && r.expiresAt > now) ?? null
  }

  findByIdempotencyKey(accountId: string, key: string, now: number): ArtifactRecord | null {
    return (
      this.records.find(
        (r) =>
          r.accountId === accountId &&
          r.idempotencyKey !== null &&
          r.idempotencyKey === key &&
          r.expiresAt > now
      ) ?? null
    )
  }

  /** The token that authorizes writes to this artifact. */
  editTokenFor(slug: string): string {
    return deriveEditToken(this.editSecret, slug)
  }

  /** True when the caller's token authorizes writes to this record. */
  authorizes(record: ArtifactRecord, editToken: string): boolean {
    return constantTimeEqual(this.editTokenFor(record.slug), editToken)
  }

  /**
   * Refuses a write that would put the account over its allowance.
   *
   * Counted before the body is written, and `replacing` excludes the record an
   * update is about to overwrite so an edit that shrinks an artifact is never
   * refused for the space its own older copy occupies.
   */
  checkQuota(
    accountId: string,
    incomingBytes: number,
    now: number,
    replacing?: ArtifactRecord
  ): QuotaFailure | null {
    const live = this.list(accountId, now).filter((record) => record !== replacing)
    if (!replacing && live.length >= this.quota.maxPerAccount) {
      return { reason: 'too_many' }
    }
    const used = live.reduce((sum, record) => sum + record.byteSize, 0)
    if (used + incomingBytes > this.quota.maxTotalBytesPerAccount) {
      return { reason: 'too_large' }
    }
    return null
  }

  create(
    write: ArtifactWrite,
    now: number,
    idempotencyKey: string | null
  ): { record: ArtifactRecord; editToken: string } {
    const slug = randomBytes(12).toString('base64url')
    const editToken = this.editTokenFor(slug)
    const record: ArtifactRecord = {
      slug,
      accountId: write.accountId,
      title: write.title,
      originalFileName: write.originalFileName,
      sourceContentType: write.sourceContentType,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + write.ttlMs,
      byteSize: write.byteSize,
      idempotencyKey
    }
    // Body first: an index entry whose body is missing is a dead link someone
    // may already have shared, while an orphaned body is collected by the sweep.
    this.writeBody(slug, write.html)
    this.records.push(record)
    this.persist()
    return { record, editToken }
  }

  update(
    record: ArtifactRecord,
    write: Omit<ArtifactWrite, 'accountId' | 'ttlMs'>,
    now: number
  ): ArtifactRecord {
    this.writeBody(record.slug, write.html)
    record.title = write.title
    record.originalFileName = write.originalFileName
    record.sourceContentType = write.sourceContentType
    record.byteSize = write.byteSize
    record.updatedAt = now
    this.persist()
    return record
  }

  remove(record: ArtifactRecord): void {
    this.records = this.records.filter((candidate) => candidate !== record)
    this.persist()
    this.removeBody(record.slug)
  }

  /** Reads a body, or null when it is missing — a link that outlived its file. */
  readBody(slug: string): string | null {
    if (!this.bodyDir) {
      return this.memory.get(slug) ?? null
    }
    try {
      return readFileSync(join(this.bodyDir, `${slug}.html`), 'utf8')
    } catch {
      return null
    }
  }

  /** Drops expired records and the bodies that went with them. */
  sweep(now: number): number {
    const expired = this.records.filter((record) => record.expiresAt <= now)
    if (expired.length === 0) {
      return 0
    }
    this.records = this.records.filter((record) => record.expiresAt > now)
    this.persist()
    for (const record of expired) {
      this.removeBody(record.slug)
    }
    return expired.length
  }

  flush(): void {
    this.file.stop()
  }

  /** Bodies live in memory when no data directory is configured. */
  private readonly memory = new Map<string, string>()

  private writeBody(slug: string, html: string): void {
    if (!this.bodyDir) {
      this.memory.set(slug, html)
      return
    }
    try {
      mkdirSync(this.bodyDir, { recursive: true })
      writeFileSync(join(this.bodyDir, `${slug}.html`), html, { mode: 0o600 })
    } catch (error) {
      this.onError(error as Error)
      throw error
    }
  }

  private removeBody(slug: string): void {
    if (!this.bodyDir) {
      this.memory.delete(slug)
      return
    }
    try {
      rmSync(join(this.bodyDir, `${slug}.html`), { force: true })
    } catch (error) {
      // A body that will not delete is disk to reclaim later, not a failed
      // request: the record is already gone and the link already answers 404.
      this.onError(error as Error)
    }
  }

  private persist(): void {
    this.file.schedule(() => ({ v: 1, artifacts: this.records }))
  }
}
