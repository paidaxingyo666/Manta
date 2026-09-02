/**
 * Failure paths a stranger can reach.
 *
 * Everything here runs inside a WebSocket 'upgrade' handler or a socket
 * callback, where an unhandled throw is not a 500 — it is the process exiting.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { request as httpRequest } from 'node:http'
import WebSocket from 'ws'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import {
  attachData,
  connectPhone,
  createInvite,
  httpFetch,
  nextClose,
  nextJson,
  onlineHost,
  open
} from './testing/client.js'

let current: TestRelay | null = null

afterEach(async () => {
  await current?.stop()
  current = null
})

/** Sends a raw upgrade so the path can be malformed in ways a URL cannot. */
function rawUpgrade(origin: string, path: string): Promise<string> {
  const url = new URL(origin)
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: Number(url.port),
      path,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': Buffer.from('0123456789abcdef').toString('base64'),
        'sec-websocket-version': '13'
      }
    })
    req.on('upgrade', (response, socket) => {
      socket.destroy()
      resolve(`upgraded:${response.statusCode}`)
    })
    req.on('response', (response) => {
      response.resume()
      resolve(`response:${response.statusCode}`)
    })
    req.on('error', (error) => reject(error))
    req.end()
  })
}

describe('hostile input', () => {
  it('survives a malformed percent-escape in the upgrade path', async () => {
    current = await startTestRelay()
    // decodeURIComponent('%') throws, and this runs in an 'upgrade' handler
    // where a throw is an uncaught exception rather than a 500.
    await rawUpgrade(current.origin, '/v1/connect/%').catch(() => 'reset')
    await rawUpgrade(current.origin, '/v1/host/data/%zz').catch(() => 'reset')
    // The only assertion that matters: the process is still serving.
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
  })

  it('refuses an unknown upgrade path without dropping the process', async () => {
    current = await startTestRelay()
    expect(await rawUpgrade(current.origin, '/v1/nope').catch(() => 'reset')).toMatch(
      /response:404|reset/
    )
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
  })

  it('lets the real data leg attach after a bogus one was refused', async () => {
    // A stale or forged leg must not evict the pending connection the desktop's
    // genuine leg is about to look up — that would strand the phone until its
    // attach deadline and fail the pairing.
    current = await startTestRelay()
    const host = await onlineHost(current.origin)
    const invite = await createInvite(host.control, 'r1', 'device-1')
    const { phone } = await connectPhone(
      current.wsOrigin,
      host.identity.relayHostId,
      String(invite.inviteToken)
    )
    const connOpen = await nextJson(host.control)

    const bogus = await open(
      new WebSocket(
        `${current.wsOrigin}/v1/host/data/${encodeURIComponent(String(connOpen.connId))}`
      )
    )
    const bogusClosed = nextClose(bogus)
    bogus.send(
      JSON.stringify({
        type: 'host-data-auth',
        v: 1,
        connTicket: 'w'.repeat(43),
        generation: host.generation
      })
    )
    expect(await bogusClosed).toBe(1008)

    const real = await attachData(current.wsOrigin, connOpen, host.generation)
    const got = new Promise<Buffer>((resolve) => real.once('message', (d) => resolve(d as Buffer)))
    await new Promise((resolve) => setTimeout(resolve, 50))
    phone.send(Buffer.from([7]), { binary: true })
    expect(Buffer.from(await got)).toEqual(Buffer.from([7]))

    for (const socket of [host.control, phone, real]) {
      socket.close()
    }
  })

  it('rejects an oversized request body as a bad request, not a crash', async () => {
    current = await startTestRelay()
    const response = await httpFetch(`${current.origin}/v1/desktop/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'x'.repeat(64 * 1024) })
    }).catch(() => null)
    // Either a refusal or a reset connection is fine; a 500 or a dead process
    // is not.
    expect(response === null || response.status === 400).toBe(true)
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
  })

  it('ignores a control frame that is not JSON without taking the session down', async () => {
    current = await startTestRelay()
    const host = await onlineHost(current.origin)
    const closed = nextClose(host.control)
    host.control.send('{ not json')
    expect(await closed).toBe(1007)
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
  })
})
