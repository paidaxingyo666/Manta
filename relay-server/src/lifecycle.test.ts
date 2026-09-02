/**
 * Process lifecycle: what an operator and a load balancer actually observe.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { connect } from 'node:net'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import {
  attachData,
  connectPhone,
  createInvite,
  nextClose,
  nextJson,
  onlineHost
} from './testing/client.js'

let current: TestRelay | null = null

afterEach(async () => {
  await current?.stop()
  current = null
})

describe('lifecycle', () => {
  it('serves health without a credential and reports draining', async () => {
    current = await startTestRelay(() => ({ shutdownGraceMs: 400 }))
    // Health also carries build info; `ok` is what a load balancer reads.
    const healthy = (await (await fetch(`${current.origin}/health`)).json()) as {
      ok: boolean
      version: string
    }
    expect(healthy.ok).toBe(true)
    expect(healthy.version).toBeTruthy()

    const stopping = current.relay.shutdown('test')
    // A load balancer needs to see the relay leave rotation *before* the socket
    // stops accepting, or it keeps sending connections into the drain window.
    const duringDrain = await fetch(`${current.origin}/health`)
    expect(duringDrain.status).toBe(503)
    await stopping
    current = null
  })

  it('tells connected phones the cell is draining instead of dropping them', async () => {
    // A bare close reaches the phone as 1006, which its close-code table treats
    // as a generic transport failure; 4503 is what makes it re-resolve.
    current = await startTestRelay(() => ({ shutdownGraceMs: 300 }))
    const host = await onlineHost(current.origin)
    const invite = await createInvite(host.control, 'l1', 'device-1')
    const { phone } = await connectPhone(
      current.wsOrigin,
      host.identity.relayHostId,
      String(invite.inviteToken)
    )
    const connOpen = await nextJson(host.control)
    await attachData(current.wsOrigin, connOpen, host.generation)

    const closed = nextClose(phone, 5_000)
    const drainNotice = nextJson(host.control)
    const stopping = current.relay.shutdown('test')
    expect(await drainNotice).toMatchObject({ type: 'drain', recovery: 'resolve-director' })
    expect(await closed).toBe(4503)
    await stopping
    current = null
  })

  it('refuses new phones while draining', async () => {
    current = await startTestRelay(() => ({ shutdownGraceMs: 300 }))
    const host = await onlineHost(current.origin)
    const invite = await createInvite(host.control, 'l2', 'device-2')
    const stopping = current.relay.shutdown('test')
    const { hello } = await connectPhone(
      current.wsOrigin,
      host.identity.relayHostId,
      String(invite.inviteToken)
    )
    expect(hello).toMatchObject({ ok: false, code: 4503 })
    await stopping
    current = null
  })

  it('keeps metrics closed unless a token is configured', async () => {
    current = await startTestRelay()
    // Not 401: an operator who never set a token has not opted into exposing
    // the endpoint at all, and 401 would advertise that it exists.
    expect((await fetch(`${current.origin}/metrics`)).status).toBe(404)
  })

  it('serves metrics to a caller holding the token', async () => {
    current = await startTestRelay(() => ({ metricsToken: 'secret-token' }))
    expect((await fetch(`${current.origin}/metrics`)).status).toBe(401)
    expect(
      (
        await fetch(`${current.origin}/metrics`, {
          headers: { authorization: 'Bearer wrong-token' }
        })
      ).status
    ).toBe(401)

    const host = await onlineHost(current.origin)
    const response = await fetch(`${current.origin}/metrics`, {
      headers: { authorization: 'Bearer secret-token' }
    })
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('manta_relay_sessions 1')
    expect(body).toContain('# TYPE manta_relay_tokens_issued_total counter')
    host.control.close()
  })

  it('answers unknown paths and wrong methods without leaking a stack', async () => {
    current = await startTestRelay()
    expect((await fetch(`${current.origin}/nope`)).status).toBe(404)
    // /session is state-changing; reaching it with a plain GET must not work.
    expect((await fetch(`${current.origin}/v1/desktop/auth/session`)).status).toBe(405)
    expect((await fetch(`${current.origin}/v1/regions`)).status).toBe(404)
  })
})

describe('shutdown cannot be held open by a peer', () => {
  it('flushes and exits even when a socket never answers the close handshake', async () => {
    // server.close() waits for every upgraded connection to end. A peer that
    // completes the WebSocket handshake and then simply stops reading holds it
    // for ws's 30s close timeout — long past the supervisor's stop grace, so
    // the process is SIGKILLed and the state flush after close never runs.
    current = await startTestRelay(() => ({ shutdownGraceMs: 100 }))
    const raw = connect({ host: '127.0.0.1', port: Number(new URL(current.origin).port) })
    await new Promise<void>((resolve, reject) => {
      raw.once('error', reject)
      raw.once('connect', () => resolve())
    })
    raw.write(
      'GET /v1/connect/aaaaaaaaaaaaaaaa HTTP/1.1\r\n' +
        `Host: 127.0.0.1\r\n` +
        'Connection: Upgrade\r\nUpgrade: websocket\r\n' +
        'Sec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\n\r\n'
    )
    await new Promise<void>((resolve) => raw.once('data', () => resolve()))
    // Deaf from here on: no reads, no close frame, no FIN.
    raw.pause()

    const started = Date.now()
    await current.relay.shutdown('test')
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(4_000)
    raw.destroy()
    current = null
  })
})
