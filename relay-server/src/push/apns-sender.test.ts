import { createServer, type Http2Server, type ServerHttp2Stream } from 'node:http2'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApnsSender } from './apns-sender.js'

/**
 * The one file in this directory that had no test, and the one that dropped
 * every notification for three days.
 *
 * These run against a real h2c server rather than a mocked session: what broke
 * was the lifetime of a cached `ClientHttp2Session`, which a stub does not have.
 */

// A key APNs will never see; ApnsProviderToken only has to be able to sign with it.
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`

const CREDENTIALS = { privateKey: PRIVATE_KEY, keyId: 'ABCDE12345', teamId: 'FGHIJ67890' }
const REQUEST = { deviceToken: 'a'.repeat(64), payload: { aps: { alert: 'hi' } } }

describe('ApnsSender', () => {
  let server: Http2Server
  let host: string
  /** What each successive request should do, consumed in order. */
  let script: ((stream: ServerHttp2Stream) => void)[]
  let requests: number

  beforeEach(async () => {
    script = []
    requests = 0
    server = createServer()
    server.on('stream', (stream) => {
      const step = script[requests] ?? script.at(-1)
      requests += 1
      step?.(stream)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const ok = (stream: ServerHttp2Stream) => {
    stream.respond({ ':status': 200 })
    stream.end()
  }
  const reject = (status: number, reason: string) => (stream: ServerHttp2Stream) => {
    stream.respond({ ':status': status })
    stream.end(JSON.stringify({ reason }))
  }
  /** The peer vanishing mid-request, which is what a dead cached session looks like. */
  const reset = (stream: ServerHttp2Stream) => {
    stream.session?.destroy()
  }

  it('delivers a push', async () => {
    script = [ok]
    await expect(
      new ApnsSender(CREDENTIALS, 'cn.example.app', host).send(REQUEST)
    ).resolves.toEqual({ ok: true })
  })

  it('retries on a fresh session when the cached one is dead', async () => {
    // The bug: APNs closes an idle connection without the relay being told, so
    // the next send writes into a dead socket and reads ECONNRESET. Before this
    // retry existed the push was simply lost — the relay logged `push.failed`
    // with `Error: read ECONNRESET` and moved on.
    script = [reset, ok]
    const sender = new ApnsSender(CREDENTIALS, 'cn.example.app', host)
    await expect(sender.send(REQUEST)).resolves.toEqual({ ok: true })
    expect(requests).toBe(2)
    sender.close()
  })

  it('gives up after one transport retry', async () => {
    // A relay that cannot reach APNs at all must report it, not spin.
    script = [reset, reset, ok]
    const sender = new ApnsSender(CREDENTIALS, 'cn.example.app', host)
    const result = await sender.send(REQUEST)
    expect(result.ok).toBe(false)
    expect(requests).toBe(2)
    sender.close()
  })

  it('does not retry a token APNs has rejected', async () => {
    // Retrying a dead token wastes a round trip and cannot succeed; the caller
    // is told to discard it instead.
    script = [reject(400, 'BadDeviceToken')]
    const sender = new ApnsSender(CREDENTIALS, 'cn.example.app', host)
    expect(await sender.send(REQUEST)).toMatchObject({
      ok: false,
      discardToken: true,
      reason: 'BadDeviceToken'
    })
    expect(requests).toBe(1)
    sender.close()
  })

  it('reuses the session across sends while it is alive', async () => {
    // The caching is the point — reconnecting per push would cost a TLS
    // handshake each time. Only a dead session should be replaced.
    script = [ok]
    const sender = new ApnsSender(CREDENTIALS, 'cn.example.app', host)
    await sender.send(REQUEST)
    await sender.send(REQUEST)
    expect(requests).toBe(2)
    sender.close()
  })
})
