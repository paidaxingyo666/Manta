import { describe, expect, it } from 'vitest'
import { connectArgsFromUnknown } from './manta-profile-connect-args'

describe('connect args from the renderer', () => {
  it('falls back to the enrolment flow when either field is missing', () => {
    // The renderer is outside the trust boundary: a half-formed object must not
    // reach the password endpoint with a blank credential.
    for (const raw of [
      undefined,
      null,
      'credentials',
      {},
      { credentials: null },
      { credentials: { email: 'ada@example.com' } },
      { credentials: { password: 'correct-horse' } },
      { credentials: { email: '   ', password: 'correct-horse' } }
    ]) {
      expect(connectArgsFromUnknown(raw)).toBeUndefined()
    }
  })

  it('normalizes a sign-in and defaults the mode', () => {
    expect(
      connectArgsFromUnknown({ credentials: { email: '  ada@example.com ', password: 'pw' } })
    ).toEqual({
      credentials: { email: 'ada@example.com', password: 'pw', mode: 'sign-in' }
    })
  })

  it('only accepts register as an explicit mode', () => {
    expect(
      connectArgsFromUnknown({
        credentials: { email: 'a@b.co', password: 'pw', mode: 'REGISTER' }
      })?.credentials?.mode
    ).toBe('sign-in')
    expect(
      connectArgsFromUnknown({
        credentials: { email: 'a@b.co', password: 'pw', mode: 'register', displayName: ' Ada ' }
      })
    ).toEqual({
      credentials: { email: 'a@b.co', password: 'pw', mode: 'register', displayName: 'Ada' }
    })
  })

  it('bounds every field so a huge body cannot be forwarded', () => {
    const args = connectArgsFromUnknown({
      credentials: {
        email: `${'a'.repeat(600)}@example.com`,
        password: 'p'.repeat(600),
        enrollmentSecret: 's'.repeat(900)
      }
    })
    expect(args?.credentials?.email.length).toBe(256)
    expect(args?.credentials?.password.length).toBe(256)
    expect(args?.credentials?.enrollmentSecret?.length).toBe(512)
  })
})
