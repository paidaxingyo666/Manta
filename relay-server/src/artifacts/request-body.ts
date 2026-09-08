/**
 * Reading and validating an artifact write.
 *
 * Split out of the handler because it is the one part that touches bytes a
 * stranger chose, and it is easier to argue about on its own: what shapes are
 * accepted, what the ceiling is, and what happens to a body that exceeds it.
 */
import type { IncomingMessage } from 'node:http'
import type { ArtifactContentType } from './store.js'

/** Leaves room for JSON escaping over the byte ceiling the desktop enforces. */
export const REQUEST_OVERHEAD = 1024 * 1024

export type WriteBody = {
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
 *
 * Returns null for a body that was malformed, cut short, or past the limit —
 * which parseWrite rejects the same way it rejects any other shape it cannot
 * use, so the caller has one refusal path rather than two.
 */
export async function readLargeJson(request: IncomingMessage, limit: number): Promise<unknown> {
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

export function parseWrite(body: unknown, maxBytes: number): WriteBody | { error: string } {
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
