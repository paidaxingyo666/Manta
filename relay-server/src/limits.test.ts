/**
 * The relay's exposed surface is unauthenticated by design, so the limits are
 * the only thing standing between it and a stranger with a loop.
 */
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import {
  connectPhone,
  createInvite,
  nextClose,
  nextJson,
  onlineHost,
  open
} from './testing/client.js'

const started: TestRelay[] = []

async function relayWith(overrides: Parameters<typeof startTestRelay>[0]): Promise<TestRelay> {
  const relay = await startTestRelay(overrides)
  started.push(relay)
  return relay
}

afterEach(async () => {
  while (started.length > 0) {
    await started.pop()!.stop()
  }
})

describe('rate limits', () => {
  it('refuses a phone flood with 4429 rather than a code it would act on', async () => {
    // 4429 makes the phone back off with jitter. The codes it would otherwise
    // see here are far more expensive: 4401 permanently retires a credential.
    const relay = await relayWith(() => ({
      limits: { phoneBurst: 3, phonePerSecond: 0.001 }
    }))
    const host = await onlineHost(relay.origin)
    const codes: number[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const phone = await open(
        new WebSocket(`${relay.wsOrigin}/v1/connect/${host.identity.relayHostId}`)
      )
      const closed = nextClose(phone)
      phone.send(
        JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential: 'z'.repeat(43) })
      )
      codes.push(await closed)
    }
    // The first three spend the burst and are answered on their own merits —
    // 4401, because the credential really is unknown. Only then does the
    // limiter take over, and 4429 is the one code here that costs the phone
    // nothing permanent.
    expect(codes).toEqual([4401, 4401, 4401, 4429, 4429])
    host.control.close()
  })

  it('answers HTTP floods with 429 and a Retry-After', async () => {
    const relay = await relayWith(() => ({ limits: { httpBurst: 2, httpPerSecond: 0.001 } }))
    const statuses: number[] = []
    let retryAfter: string | null = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${relay.origin}/v1/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ relayHostId: 'a'.repeat(16), resumeToken: 'b'.repeat(43) })
      })
      statuses.push(response.status)
      retryAfter = response.headers.get('retry-after') ?? retryAfter
    }
    expect(statuses.slice(0, 2)).toEqual([200, 200])
    expect(statuses.slice(2)).toEqual([429, 429])
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  it('limits the auth endpoints separately from everything else', async () => {
    const relay = await relayWith(() => ({ limits: { authBurst: 2, authPerSecond: 0.001 } }))
    const statuses: number[] = []
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${relay.origin}/v1/desktop/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'nope' })
      })
      statuses.push(response.status)
    }
    expect(statuses).toEqual([400, 400, 429, 429])
  })

  it('throttles a desktop that spins the control leg', async () => {
    const relay = await relayWith(() => ({ limits: { controlBurst: 3, controlPerSecond: 0.001 } }))
    const host = await onlineHost(relay.origin)
    const replies: string[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reply = await createInvite(host.control, `req-${attempt}`, 'device-x')
      replies.push(String(reply.code ?? reply.type))
    }
    expect(replies.slice(0, 3)).toEqual(['invite-created', 'invite-created', 'invite-created'])
    expect(replies.slice(3)).toEqual(['rate_limited', 'rate_limited'])
    host.control.close()
  })

  it('caps how many invites a host can leave outstanding', async () => {
    const relay = await relayWith(() => ({ maxLiveInvitesPerHost: 2 }))
    const host = await onlineHost(relay.origin)
    const codes: string[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const reply = await createInvite(host.control, `inv-${attempt}`, `device-${attempt}`)
      codes.push(String(reply.code ?? reply.type))
    }
    expect(codes).toEqual(['invite-created', 'invite-created', 'too_many_invites'])
    host.control.close()
  })

  it('caps concurrent connections so unattached phones cannot pile up', async () => {
    const relay = await relayWith(() => ({ maxConnsPerHost: 1, attachDeadlineMs: 30_000 }))
    const host = await onlineHost(relay.origin)
    const first = await createInvite(host.control, 'p1', 'device-a')
    await connectPhone(relay.wsOrigin, host.identity.relayHostId, String(first.inviteToken))
    await nextJson(host.control)

    const second = await createInvite(host.control, 'p2', 'device-b')
    const phone = await open(
      new WebSocket(`${relay.wsOrigin}/v1/connect/${host.identity.relayHostId}`)
    )
    const closed = nextClose(phone)
    phone.send(
      JSON.stringify({
        type: 'relay-auth',
        v: 1,
        mode: 'connect',
        credential: second.inviteToken
      })
    )
    expect(await closed).toBe(4429)
    host.control.close()
  })

  it("does not let a stranger spend the owner's connect budget", async () => {
    // The per-host bucket is keyed on relayHostId alone and shared by every
    // phone that desktop owns. If a failed credential still charged it, anyone
    // who learned the host id could hold it at zero from a couple of addresses
    // and lock the owner's real phones out indefinitely — while staying well
    // inside their own per-source budget.
    const relay = await relayWith(() => ({
      trustedProxies: 'loopback',
      limits: { phoneBurst: 5, phonePerSecond: 0.001 }
    }))
    const host = await onlineHost(relay.origin)
    const invite = await createInvite(host.control, 'lock-1', 'device-1')

    // Ten attempts, each from a different source, so no attacker ever exhausts
    // their own bucket. Only the shared per-host bucket is under pressure.
    for (let index = 0; index < 10; index += 1) {
      const phone = await open(
        new WebSocket(`${relay.wsOrigin}/v1/connect/${host.identity.relayHostId}`, {
          headers: { 'x-forwarded-for': `203.0.113.${index + 1}` }
        })
      )
      const closed = nextClose(phone)
      phone.send(
        JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential: 'q'.repeat(43) })
      )
      // A worthless credential earns 4401, which is correct and costs the
      // attacker nothing they care about.
      expect(await closed).toBe(4401)
    }

    // The owner's phone, arriving afterwards with a genuine invite.
    const victim = await open(
      new WebSocket(`${relay.wsOrigin}/v1/connect/${host.identity.relayHostId}`, {
        headers: { 'x-forwarded-for': '203.0.113.250' }
      })
    )
    victim.send(
      JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential: invite.inviteToken })
    )
    expect(await nextJson(victim)).toMatchObject({ ok: true, credentialKind: 'invite' })
    host.control.close()
  })

  it('rejects a data leg presenting the wrong ticket', async () => {
    const relay = await relayWith(() => ({}))
    const host = await onlineHost(relay.origin)
    const invite = await createInvite(host.control, 'd1', 'device-d')
    await connectPhone(relay.wsOrigin, host.identity.relayHostId, String(invite.inviteToken))
    const connOpen = await nextJson(host.control)

    const data = await open(
      new WebSocket(`${relay.wsOrigin}/v1/host/data/${encodeURIComponent(String(connOpen.connId))}`)
    )
    const closed = nextClose(data)
    data.send(
      JSON.stringify({
        type: 'host-data-auth',
        v: 1,
        connTicket: 'w'.repeat(43),
        generation: host.generation
      })
    )
    expect(await closed).toBe(1008)
    host.control.close()
  })
})

describe('sign-in rate limiting', () => {
  it('does not let a spread-out attacker lock an account out everywhere', async () => {
    // Keyed on the address alone the bucket is a lockout primitive: attempts
    // from many sources all charge one bucket, and the owner is then refused
    // from every network. The per-source bucket is what bounds an attacker.
    const current = await relayWith(() => ({
      trustedProxies: 'loopback',
      limits: { authBurst: 6, authPerSecond: 0.01, httpBurst: 1_000, httpPerSecond: 100 }
    }))
    const login = (source: string, password: string): Promise<Response> =>
      fetch(`${current.origin}/v1/desktop/auth/login`, {
        method: 'POST',
        headers: {
          connection: 'close',
          'content-type': 'application/json',
          'x-forwarded-for': source
        },
        body: JSON.stringify({ email: 'ada@example.com', password })
      })

    expect(
      (
        await fetch(`${current.origin}/v1/desktop/auth/register`, {
          method: 'POST',
          headers: { connection: 'close', 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'ada@example.com', password: 'correct-horse' })
        })
      ).status
    ).toBe(200)

    // Each attempt from a different source, so the per-source bucket never
    // runs out and every one of them reaches the per-address bucket.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect((await login(`198.51.100.${attempt}`, 'wrong')).status).toBe(401)
    }

    expect((await login('203.0.113.9', 'correct-horse')).status).toBe(200)
  })
})
