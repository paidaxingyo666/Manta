/**
 * The artifact API and the pages it publishes.
 *
 * Two surfaces with opposite audiences behind one handler: `/v1/artifacts*` is
 * authenticated and speaks the desktop's contract, `/a/{slug}` is the public
 * link and is served to anyone. They share a handler because they share a
 * store; they must not share an origin, which loadConfig refuses to allow.
 *
 * The bearer is the same session token the auth server minted, so this checks
 * it against the same session store. An artifact host that verified its own
 * credential would be a second identity system for one deployment.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthSessionStore } from '../auth/store.js'
import type { Logger } from '../shared/log.js'
import type { Metrics } from '../metrics.js'
import type { RateLimiter } from '../shared/rate-limit.js'
import { json } from '../shared/http-json.js'
import { rateLimitKey } from '../shared/client-ip.js'
import { renderMarkdown } from './markdown.js'
import type { ArtifactRecord, ArtifactStore } from './store.js'
import { servePublishedPage, wrapDocument } from './published-page.js'
import { parseWrite, readLargeJson, REQUEST_OVERHEAD, type WriteBody } from './request-body.js'

export type ArtifactServerOptions = {
  store: ArtifactStore
  sessions: AuthSessionStore
  /** Origin published links point at; never the relay's own. */
  publicUrl: string
  maxBytes: number
  ttlMs: number
  logger: Logger
  metrics: Metrics
  limiter: RateLimiter
}

export class ArtifactServer {
  constructor(private readonly options: ArtifactServerOptions) {}

  private shareUrl(slug: string): string {
    return `${this.options.publicUrl}/a/${slug}`
  }

  /** The wire shape the desktop parses. Field names are its contract, not ours. */
  private item(record: ArtifactRecord): Record<string, unknown> {
    return {
      artifact: {
        version: 1,
        slug: record.slug,
        title: record.title,
        originalFileName: record.originalFileName,
        sourceContentType: record.sourceContentType,
        renderedContentType: 'text/html',
        createdAt: new Date(record.createdAt).toISOString(),
        updatedAt: new Date(record.updatedAt).toISOString(),
        expiresAt: new Date(record.expiresAt).toISOString(),
        byteSize: record.byteSize,
        deletedAt: null
      },
      shareUrl: this.shareUrl(record.slug)
    }
  }

  /** Bearer to account, or null. Same store the auth server writes. */
  private authenticate(request: IncomingMessage, now: number): string | null {
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return null
    }
    return this.options.sessions.findByAccess(header.slice(7), now)?.accountId ?? null
  }

  private editToken(request: IncomingMessage): string {
    const header = request.headers['x-manta-edit-token']
    return typeof header === 'string' ? header : ''
  }

  private renderHtml(write: WriteBody): string {
    // Markdown is rendered to a page this file controls end to end. HTML is
    // stored as sent: rewriting someone's document is not this server's job,
    // and the origin — not a filter — is what contains it.
    return write.contentType === 'text/markdown'
      ? wrapDocument(write.title ?? write.fileName, renderMarkdown(write.content))
      : write.content
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    clientIp: string
  ): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://artifacts.local')
    const path = url.pathname
    if (path.startsWith('/a/')) {
      servePublishedPage(this.options.store, path.slice('/a/'.length), response)
      return true
    }
    if (path !== '/v1/artifacts' && !path.startsWith('/v1/artifacts/')) {
      return false
    }

    const { logger, metrics, limiter, store } = this.options
    const decision = limiter.take(`artifacts:${rateLimitKey(clientIp)}`)
    if (!decision.ok) {
      metrics.counter('manta_relay_rate_limited_total', 'Requests refused by a rate limiter.', {
        surface: 'artifacts'
      })
      json(
        response,
        429,
        { error: 'rate_limited', code: 'rate_limited' },
        {
          'retry-after': String(Math.ceil(decision.retryAfterMs / 1000))
        }
      )
      return true
    }

    const now = Date.now()
    const accountId = this.authenticate(request, now)
    if (!accountId) {
      json(response, 401, { error: 'unauthorized', code: 'unauthorized' })
      return true
    }
    // Cheap and bounded, and it keeps a listing from showing an artifact whose
    // link has already stopped working.
    store.sweep(now)

    const slug = path.startsWith('/v1/artifacts/')
      ? decodeURIComponent(path.slice('/v1/artifacts/'.length))
      : ''

    try {
      if (!slug) {
        if (request.method === 'GET') {
          this.listArtifacts(accountId, response, now)
          return true
        }
        if (request.method === 'POST') {
          await this.createArtifact(request, response, accountId, now)
          return true
        }
        json(
          response,
          405,
          { error: 'method_not_allowed', code: 'method_not_allowed' },
          {
            allow: 'GET, POST'
          }
        )
        return true
      }
      if (request.method === 'PUT') {
        await this.updateArtifact(request, response, accountId, slug, now)
        return true
      }
      if (request.method === 'DELETE') {
        this.deleteArtifact(request, response, accountId, slug, now)
        return true
      }
      json(
        response,
        405,
        { error: 'method_not_allowed', code: 'method_not_allowed' },
        {
          allow: 'PUT, DELETE'
        }
      )
      return true
    } catch (error) {
      logger.error('artifacts.request_failed', { error, method: request.method ?? '', slug })
      if (!response.headersSent) {
        json(response, 500, { error: 'internal_error', code: 'internal_error' })
      }
      return true
    }
  }

  private listArtifacts(accountId: string, response: ServerResponse, now: number): void {
    const artifacts = this.options.store.list(accountId, now).map((record) => this.item(record))
    // No cursor: the per-account cap is two digits, so a page boundary would be
    // machinery for a case the quota already prevents. nextCursor stays absent,
    // which the desktop reads as "that was all of them".
    json(response, 200, { artifacts })
  }

  private async createArtifact(
    request: IncomingMessage,
    response: ServerResponse,
    accountId: string,
    now: number
  ): Promise<void> {
    const { store, maxBytes, ttlMs, metrics } = this.options
    const idempotencyKey = (() => {
      const header = request.headers['idempotency-key']
      return typeof header === 'string' && header.length <= 200 ? header : null
    })()
    if (idempotencyKey) {
      // The desktop retries a create whose response it never saw, and it needs
      // the *same* answer — including the edit token, which it then uses to
      // finish the publish. Anything else and a lost reply becomes either two
      // artifacts or a publish that can never complete. The token is derived
      // from the slug, so replaying it costs nothing and stores nothing.
      const existing = store.findByIdempotencyKey(accountId, idempotencyKey, now)
      if (existing) {
        json(response, 200, {
          ...this.item(existing),
          editToken: store.editTokenFor(existing.slug)
        })
        return
      }
    }
    const body = await readLargeJson(request, maxBytes + REQUEST_OVERHEAD)
    const write = parseWrite(body, maxBytes)
    if ('error' in write) {
      json(response, write.error === 'content_too_large' ? 413 : 400, {
        error: write.error,
        code: write.error
      })
      return
    }
    const quota = store.checkQuota(accountId, Buffer.byteLength(write.content, 'utf8'), now)
    if (quota) {
      json(response, 413, { error: quota.reason, code: quota.reason })
      return
    }
    const { record, editToken } = store.create(
      {
        accountId,
        title: write.title ?? null,
        originalFileName: write.fileName,
        sourceContentType: write.contentType,
        byteSize: Buffer.byteLength(write.content, 'utf8'),
        html: this.renderHtml(write),
        ttlMs
      },
      now,
      idempotencyKey
    )
    metrics.counter('manta_relay_artifacts_total', 'Artifacts published.', { op: 'create' })
    json(response, 201, { ...this.item(record), editToken })
  }

  private async updateArtifact(
    request: IncomingMessage,
    response: ServerResponse,
    accountId: string,
    slug: string,
    now: number
  ): Promise<void> {
    const { store, maxBytes, metrics } = this.options
    const record = store.find(slug, now)
    if (!record || record.accountId !== accountId) {
      json(response, 404, { error: 'artifact_not_found', code: 'artifact_not_found' })
      return
    }
    if (!store.authorizes(record, this.editToken(request))) {
      json(response, 403, { error: 'forbidden', code: 'forbidden' })
      return
    }
    const body = await readLargeJson(request, maxBytes + REQUEST_OVERHEAD)
    const write = parseWrite(body, maxBytes)
    if ('error' in write) {
      json(response, write.error === 'content_too_large' ? 413 : 400, {
        error: write.error,
        code: write.error
      })
      return
    }
    const byteSize = Buffer.byteLength(write.content, 'utf8')
    const quota = store.checkQuota(accountId, byteSize, now, record)
    if (quota) {
      json(response, 413, { error: quota.reason, code: quota.reason })
      return
    }
    const updated = store.update(
      record,
      {
        title: write.title ?? null,
        originalFileName: write.fileName,
        sourceContentType: write.contentType,
        byteSize,
        html: this.renderHtml(write)
      },
      now
    )
    metrics.counter('manta_relay_artifacts_total', 'Artifacts published.', { op: 'update' })
    json(response, 200, this.item(updated))
  }

  private deleteArtifact(
    request: IncomingMessage,
    response: ServerResponse,
    accountId: string,
    slug: string,
    now: number
  ): void {
    const { store, metrics } = this.options
    const record = store.find(slug, now)
    if (!record || record.accountId !== accountId) {
      // The desktop treats exactly this pair as "already gone" and stops
      // retrying, which is what makes an interrupted unshare converge.
      json(response, 404, { error: 'artifact_not_found', code: 'artifact_not_found' })
      return
    }
    // An edit token is proof for a caller holding only a link. The owner's
    // bearer is proof on its own, which is how the app deletes from its list.
    const provided = this.editToken(request)
    if (provided && !store.authorizes(record, provided)) {
      json(response, 403, { error: 'forbidden', code: 'forbidden' })
      return
    }
    store.remove(record)
    metrics.counter('manta_relay_artifacts_total', 'Artifacts published.', { op: 'delete' })
    response.writeHead(204, { 'cache-control': 'no-store' })
    response.end()
  }
}
