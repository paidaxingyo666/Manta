/**
 * Enrolment.
 *
 * The gate is on `/session`, not `/authorize`. A code is worthless on its own,
 * and `/session` is a POST the desktop makes itself — so the secret rides in
 * the request body rather than a URL query string, where it would end up in
 * proxy logs and browser history.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import { httpFetch, signIn } from './testing/client.js'

let current: TestRelay | null = null

afterEach(async () => {
  await current?.stop()
  current = null
})

const REDIRECT = 'http://127.0.0.1:1/auth/callback'

function authorizeUrl(origin: string, extra = ''): string {
  return `${origin}/v1/desktop/auth/authorize?redirect_uri=${encodeURIComponent(REDIRECT)}&state=s1${extra}`
}

describe('enrolment secret', () => {
  it('still hands out a code without the secret — the code alone is useless', async () => {
    current = await startTestRelay(() => ({ enrollmentSecret: 'open-sesame' }))
    const response = await httpFetch(authorizeUrl(current.origin), { redirect: 'manual' })
    // No HTML form, no browser step: /authorize behaves like plain OAuth.
    expect(response.status).toBe(302)
    expect(new URL(response.headers.get('location')!).searchParams.get('code')).toMatch(/^code-/)
  })

  it('refuses to exchange that code without the secret', async () => {
    current = await startTestRelay(() => ({ enrollmentSecret: 'open-sesame' }))
    const authorize = await httpFetch(authorizeUrl(current.origin), { redirect: 'manual' })
    const code = new URL(authorize.headers.get('location')!).searchParams.get('code')

    for (const body of [
      { code },
      { code, enrollmentSecret: 'wrong' },
      { code, enrollmentSecret: '' }
    ]) {
      const response = await httpFetch(`${current.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ error: 'invalid_enrollment_secret' })
    }
  })

  it('exchanges the code once the secret is right', async () => {
    current = await startTestRelay(() => ({ enrollmentSecret: 'open-sesame' }))
    const authorize = await httpFetch(authorizeUrl(current.origin), { redirect: 'manual' })
    const code = new URL(authorize.headers.get('location')!).searchParams.get('code')
    const response = await httpFetch(`${current.origin}/v1/desktop/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, enrollmentSecret: 'open-sesame' })
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      capabilities: { flags: { 'relay.use': true } }
    })
  })

  it('does not spend the code on a failed secret check', async () => {
    // Otherwise one wrong paste forces the whole browser round trip again.
    current = await startTestRelay(() => ({ enrollmentSecret: 'open-sesame' }))
    const authorize = await httpFetch(authorizeUrl(current.origin), { redirect: 'manual' })
    const code = new URL(authorize.headers.get('location')!).searchParams.get('code')
    await httpFetch(`${current.origin}/v1/desktop/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, enrollmentSecret: 'wrong' })
    })
    const retry = await httpFetch(`${current.origin}/v1/desktop/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, enrollmentSecret: 'open-sesame' })
    })
    expect(retry.status).toBe(200)
  })

  it('still allows a loopback deployment to enrol with no secret at all', async () => {
    current = await startTestRelay()
    const session = await signIn(current.origin)
    expect(session.accessToken).toBeTruthy()
  })
})
