/**
 * Reading values off the wire.
 *
 * Every one of these runs inside a WebSocket callback, where a throw is not a
 * 500 — it is `uncaughtException`, and the process is gone. Two coercions that
 * look completely safe are not:
 *
 *   JSON.parse('null')                  → a successful parse producing null,
 *                                         so the crash is the property read
 *                                         *after* the try/catch.
 *   String({ toString: null })          → throws, because ToPrimitive has
 *                                         nothing callable left to try.
 *
 * So nothing here coerces. A value is either the shape we asked for or it is
 * rejected, and the caller decides what that means.
 */

/** A parsed frame, or null if it is not a plain JSON object. */
export function parseFrame(raw: string): Record<string, unknown> | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/** A string field, or null. Never coerces — an object here would throw. */
export function str(value: unknown, maxLength = 256): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null
}

/** A non-negative safe integer, or null. Rejects -1, 1.5, 1e309, and NaN. */
export function uint(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
    ? value
    : null
}

/**
 * Identifiers that end up as object keys or state-map keys.
 *
 * `__proto__` as a device id is the difference between one host revoking its
 * own device and every host on the cell losing every device, so the character
 * set is an allowlist rather than a denylist of the names that happen to be
 * dangerous today.
 */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/

export function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null
}
