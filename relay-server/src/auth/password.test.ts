/**
 * Password hashing.
 *
 * The parameters are encoded into the stored string so they can be raised
 * later, which means a stored record is also an instruction to this process
 * about how much memory to allocate — so the bounds matter as much as the
 * comparison does.
 */
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('password hashing', () => {
  it('round-trips and rejects a near miss', async () => {
    const stored = await hashPassword('correct-horse-battery-staple')
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true)
    expect(await verifyPassword('correct-horse-battery-staple', stored)).toBe(true)
    expect(await verifyPassword('correct-horse-battery-stapl', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('salts, so the same password never stores the same bytes', async () => {
    const a = await hashPassword('correct-horse')
    const b = await hashPassword('correct-horse')
    expect(a).not.toBe(b)
    expect(await verifyPassword('correct-horse', b)).toBe(true)
  })

  it('normalizes, so the same characters typed differently still match', async () => {
    // NFC and NFD forms of "café" are different byte strings for the same
    // password, and which one arrives depends on the keyboard.
    const stored = await hashPassword('café-pass')
    expect(await verifyPassword('café-pass', stored)).toBe(true)
  })

  it('fails a malformed record instead of throwing', async () => {
    // A hand-edited or truncated state file must fail the sign-in, not take
    // the endpoint down for everyone.
    for (const stored of [
      null,
      '',
      'not-a-hash',
      'scrypt$16384$8$1$onlyfourfields',
      'bcrypt$16384$8$1$c2FsdA$aGFzaA',
      'scrypt$notanumber$8$1$c2FsdA$aGFzaA',
      'scrypt$16384$8$1$$aGFzaA'
    ]) {
      expect(await verifyPassword('correct-horse', stored)).toBe(false)
    }
  })

  it('refuses a record that would ask this process for absurd memory', async () => {
    // 128*N*r bytes: a tampered N is a one-line OOM of the whole relay.
    expect(await verifyPassword('correct-horse', 'scrypt$1073741824$8$1$c2FsdA$aGFzaA')).toBe(false)
    expect(await verifyPassword('correct-horse', 'scrypt$16384$1024$1$c2FsdA$aGFzaA')).toBe(false)
  })

  it('refuses a record whose digest is the wrong length', async () => {
    const stored = await hashPassword('correct-horse')
    const truncated = stored.slice(0, -4)
    expect(await verifyPassword('correct-horse', truncated)).toBe(false)
  })
})
