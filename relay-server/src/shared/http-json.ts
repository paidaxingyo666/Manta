/**
 * JSON request and response helpers.
 *
 * Shared because the auth and director surfaces had identical copies, and the
 * details that matter are easy to drop when copying: `no-store` on a response
 * that carries a session, `nosniff`, and a body reader that stops rather than
 * buffers when a stranger sends more than the endpoint could ever need.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export const MAX_BODY_BYTES = 16 * 1024

export function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>
): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  })
  response.end(payload)
}

/** Reads a JSON body, or null if it is malformed, oversized, or cut short. */
export async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += (chunk as Buffer).byteLength
      if (size > MAX_BODY_BYTES) {
        // Stop reading rather than keep buffering. Destroying the request makes
        // the async iterator reject, which is why the loop is guarded: an
        // oversize body is a bad request, not a 500.
        request.destroy()
        return null
      }
      chunks.push(chunk as Buffer)
    }
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}
