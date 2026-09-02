/**
 * Password hashing for relay accounts.
 *
 * scrypt from `node:crypto` rather than argon2/bcrypt: the relay ships as a
 * dependency-light container and a native addon would have to be rebuilt for
 * every base image it runs on. The parameters are encoded into the stored
 * string so they can be raised later without invalidating existing accounts.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/** ~16 MB of work per attempt: painful to grind, unnoticeable on one sign-in. */
const N = 16_384
const R = 8
const P = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16
/** scrypt needs 128*N*r bytes; the default 32 MB ceiling is too close to it. */
const MAX_MEM = 64 * 1024 * 1024

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: MAX_MEM },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(password, salt, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed record: a corrupted or
 * hand-edited entry must fail the sign-in, not take down the endpoint.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    return false
  }
  const parts: (string | undefined)[] = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt' || !parts[4] || !parts[5]) {
    return false
  }
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false
  }
  // Bound what a stored record can ask this process to allocate: a tampered
  // state file must not be able to turn one sign-in into an OOM.
  if (n < 1024 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) {
    return false
  }
  const salt = Buffer.from(parts[4], 'base64url')
  const expected = Buffer.from(parts[5], 'base64url')
  if (salt.byteLength === 0 || expected.byteLength !== KEY_LENGTH) {
    return false
  }
  let actual: Buffer
  try {
    actual = await derive(password, salt, n, r, p)
  } catch {
    return false
  }
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

/** Rejects passwords that would make an account trivially grindable. */
export const MIN_PASSWORD_LENGTH = 8
/** Bounds the scrypt input so a huge body cannot be turned into CPU time. */
export const MAX_PASSWORD_LENGTH = 256
