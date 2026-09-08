/**
 * The relay's name for a failure, read off the response that carries it.
 *
 * Its own module because it is the one place that reads a body nobody asked
 * for, under two constraints that pull against each other: the name has to
 * come out, and the body must never be left unread — leaving one can take the
 * process down from inside Node's bundled undici (see unread-response-body.ts).
 */
/** A body that will not arrive must not hold the sign-in call open. */
const ERROR_BODY_READ_TIMEOUT_MS = 2_000
/** An error name is a short string; anything larger is not one. */
const ERROR_BODY_MAX_BYTES = 64 * 1024

/**
 * The relay's name for a failure, if it gave one.
 *
 * Accepts `error` as well as `code`: the auth endpoints answer with `error` and
 * the artifact endpoints with `code`, and a caller matching on the name should
 * not have to know which surface answered.
 *
 * Why the read is raced rather than simply awaited: a body can stall half-sent,
 * and there is no timeout on reading one — the fetch signal has already been
 * satisfied by the headers. Left unbounded, a stalled error body would hang the
 * awaited IPC call behind it forever. Whichever way it ends, the body is read
 * or cancelled, because leaving one unread can take the process down from
 * inside bundled undici.
 */
export async function readCloudErrorCode(response: Response): Promise<string | undefined> {
  const stream = response.body
  if (!stream) {
    return undefined
  }
  // Why a reader rather than response.json(): json() locks the stream, and a
  // cancel on a locked stream throws instead of cancelling — so the body would
  // be left unread after all, which is the failure this guards against. Owning
  // the reader means the same handle that stalls is the one that cancels.
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let abandoned = false
  const deadline = setTimeout(() => {
    abandoned = true
    void reader.cancel().catch(() => {})
  }, ERROR_BODY_READ_TIMEOUT_MS)
  deadline.unref?.()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (!value) {
        continue
      }
      size += value.byteLength
      if (size > ERROR_BODY_MAX_BYTES) {
        abandoned = true
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
  } catch {
    // The read was cancelled under us, or the socket died mid-body.
    abandoned = true
  } finally {
    clearTimeout(deadline)
  }
  if (abandoned) {
    return undefined
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      code?: unknown
      error?: unknown
    } | null
    for (const candidate of [parsed?.code, parsed?.error]) {
      if (typeof candidate === 'string' && candidate) {
        return candidate
      }
    }
  } catch {
    // A failure with no JSON body is ordinary — a proxy's HTML error page, say.
    // The status is what the caller falls back to, and the body is fully read.
  }
  return undefined
}
