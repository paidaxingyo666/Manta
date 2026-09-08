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
import { type ArtifactContentType, type ArtifactRecord, ArtifactStore } from './store.js'

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

/** Leaves room for JSON escaping over the byte ceiling the desktop enforces. */
const REQUEST_OVERHEAD = 1024 * 1024

type WriteBody = {
  content: string
  contentType: ArtifactContentType
  fileName: string
  title?: string
}

function isContentType(value: unknown): value is ArtifactContentType {
  return value === 'text/html' || value === 'text/markdown'
}

/**
 * Reads a body up to the artifact ceiling.
 *
 * Not shared/http-json's reader: that one caps at 16 KiB, which is right for a
 * credential exchange and three orders of magnitude below an artifact.
 */
async function readLargeJson(request: IncomingMessage, limit: number): Promise<unknown | null> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += (chunk as Buffer).byteLength
      if (size > limit) {
        request.destroy()
        return null
      }
      chunks.push(chunk as Buffer)
    }
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return null
  }
}

function parseWrite(body: unknown, maxBytes: number): WriteBody | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'invalid_body' }
  }
  const source = body as Record<string, unknown>
  if (typeof source.content !== 'string' || !isContentType(source.contentType)) {
    return { error: 'invalid_body' }
  }
  if (typeof source.fileName !== 'string' || source.fileName.length > 512) {
    return { error: 'invalid_body' }
  }
  if (
    source.title !== undefined &&
    (typeof source.title !== 'string' || source.title.length > 512)
  ) {
    return { error: 'invalid_body' }
  }
  if (Buffer.byteLength(source.content, 'utf8') > maxBytes) {
    return { error: 'content_too_large' }
  }
  return {
    content: source.content,
    contentType: source.contentType,
    fileName: source.fileName,
    ...(typeof source.title === 'string' ? { title: source.title } : {})
  }
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
      this.serve(path.slice('/a/'.length), response)
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

  /**
   * The public link.
   *
   * Unauthenticated on purpose — that is what sharing means — and every header
   * here is about the fact that the bytes below were written by a stranger.
   */
  private serve(rawSlug: string, response: ServerResponse): void {
    const slug = decodeURIComponent(rawSlug)
    const record = this.options.store.find(slug, Date.now())
    const body = record ? this.options.store.readBody(slug) : null
    if (!record || body === null) {
      response.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      })
      response.end('Not found\n')
      return
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      // No caching: an artifact is edited in place and its link does not change,
      // so a cached copy is how a correction fails to reach anyone.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // Not this origin's to be framed by. An artifact framed inside another
      // page is a clickjacking surface for whatever that page overlays.
      'x-frame-options': 'DENY',
      // Cuts the two escapes that survive origin isolation: a form posting the
      // viewer's input somewhere, and a <base> silently retargeting every link.
      'content-security-policy': "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'referrer-policy': 'no-referrer'
    })
    response.end(body)
  }
}

/** Chrome for a rendered markdown page. HTML artifacts are never wrapped. */
function wrapDocument(title: string, html: string): string {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 44rem; line-height: 1.7;
  font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
pre { overflow-x: auto; padding: 0.75rem 1rem; border-radius: 6px; background: rgba(127,127,127,0.12); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
pre code { font-size: 0.88em; }
blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid rgba(127,127,127,0.35); }
img { max-width: 100%; }
table { border-collapse: collapse; }
hr { border: 0; border-top: 1px solid rgba(127,127,127,0.3); margin: 2rem 0; }
</style>
</head>
<body>
${html}
</body>
</html>
`
}
