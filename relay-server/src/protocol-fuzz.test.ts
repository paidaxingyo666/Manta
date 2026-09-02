/**
 * Frames a stranger can send to the public endpoints.
 *
 * Every handler here runs inside a ws callback, where a throw is not a 500 — it
 * is `uncaughtException`, and the process exits. `/v1/connect/{id}` in
 * particular is reachable with no credential of any kind, so one malformed
 * frame reaching an unguarded coercion is a remote kill.
 */
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import {
  connectPhone,
  createInvite,
  httpFetch,
  newHostIdentity,
  nextJson,
  onlineHost,
  open,
  relayTokenFor,
  signIn
} from './testing/client.js'
import { hashCredential, mintToken } from './shared/protocol.js'

let current: TestRelay | null = null

afterEach(async () => {
  await current?.stop()
  current = null
})

/** Sends one raw frame to the phone endpoint and waits for the socket to end. */
async function phoneFrame(relay: TestRelay, hostId: string, payload: string): Promise<void> {
  const ws = await open(new WebSocket(`${relay.wsOrigin}/v1/connect/${hostId}`))
  await new Promise<void>((resolve) => {
    ws.once('close', () => resolve())
    ws.once('error', () => resolve())
    ws.send(payload)
  })
}

describe('malformed frames on the unauthenticated phone endpoint', () => {
  it('survives a frame that parses to null rather than an object', async () => {
    current = await startTestRelay()
    // JSON.parse('null') is a successful parse producing null, so a try/catch
    // around the parse does not help: the crash is the property read after it.
    await phoneFrame(current, 'a'.repeat(16), 'null')
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
  })

  it('survives non-object and hostile-primitive frames', async () => {
    current = await startTestRelay()
    for (const payload of [
      '"a string"',
      '42',
      'true',
      '[]',
      '[{"type":"relay-auth"}]',
      // String() on this throws: toString is not callable and valueOf returns
      // an object, so ToPrimitive has nothing left to try.
      '{"type":"relay-auth","mode":"connect","credential":{"toString":null}}',
      '{"type":"relay-auth","mode":"connect","credential":{"toString":null,"valueOf":null}}'
    ]) {
      await phoneFrame(current, 'a'.repeat(16), payload)
    }
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
  })
})

describe('malformed frames on the control leg', () => {
  async function controlLeg(relay: TestRelay): Promise<WebSocket> {
    const session = await signIn(relay.origin)
    const identity = newHostIdentity()
    const relayToken = await relayTokenFor(relay.origin, session.accessToken, identity.relayHostId)
    const ws = await open(
      new WebSocket(`${relay.wsOrigin}/v1/host/control`, {
        headers: { authorization: `Bearer ${relayToken}` }
      })
    )
    return Object.assign(ws, { identity })
  }

  it('survives out-of-range numbers in host-hello', async () => {
    current = await startTestRelay()
    // These reach the challenge transcript, where they become
    // writeBigUInt64BE(BigInt(value)) — which throws for anything negative or
    // fractional, before the host proof has verified anything at all.
    for (const previousGeneration of [-1, 1.5, Infinity, -0.0001, Number.MAX_VALUE]) {
      const control = (await controlLeg(current)) as WebSocket & {
        identity: ReturnType<typeof newHostIdentity>
      }
      control.send(
        JSON.stringify({
          type: 'host-hello',
          v: 1,
          relayHostId: control.identity.relayHostId,
          assignmentEpoch: 1,
          hostPublicKeyB64: control.identity.hostPublicKey.toString('base64'),
          appVersion: 'test',
          previousGeneration
        })
      )
      await new Promise<void>((resolve) => {
        control.once('close', () => resolve())
        control.once('message', () => resolve())
        setTimeout(resolve, 500)
      })
      control.close()
    }
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
  })

  it('survives a null control frame', async () => {
    current = await startTestRelay()
    const control = await controlLeg(current)
    await new Promise<void>((resolve) => {
      control.once('close', () => resolve())
      setTimeout(resolve, 300)
      control.send('null')
    })
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
  })
})

describe('one host cannot reach across into another host state', () => {
  it('refuses a device id that names an object prototype key', async () => {
    // host.devices is a plain object, so devices['__proto__'] resolves to
    // Object.prototype. Writing revokedAt onto it makes *every* device on
    // *every* host look revoked, and each phone is then told 4401 — the code
    // that permanently retires its credential.
    current = await startTestRelay()

    const victim = await onlineHost(current.origin)
    const invite = await createInvite(victim.control, 'v1', 'victim-device')
    await connectPhone(current.wsOrigin, victim.identity.relayHostId, String(invite.inviteToken))
    const connOpen = await nextJson(victim.control)
    const token = mintToken()
    victim.control.send(
      JSON.stringify({
        type: 'device-credential-install',
        reqId: 'v-install',
        relayDeviceId: 'victim-device',
        newResumeTokenHash: hashCredential(token),
        authorization: { mode: 'relay-basis', basisConnId: connOpen.connId }
      })
    )
    await nextJson(victim.control)

    const before = await connectPhone(current.wsOrigin, victim.identity.relayHostId, token)
    expect(before.hello.ok).toBe(true)
    before.phone.close()
    await nextJson(victim.control)

    // A completely unrelated host, with its own freshly generated key.
    const attacker = await onlineHost(current.origin)
    for (const relayDeviceId of ['__proto__', 'constructor', 'prototype']) {
      attacker.control.send(
        JSON.stringify({ type: 'device-revoke', reqId: `a-${relayDeviceId}`, relayDeviceId })
      )
      await nextJson(attacker.control)
    }

    const after = await connectPhone(current.wsOrigin, victim.identity.relayHostId, token)
    expect(after.hello).toMatchObject({ ok: true, credentialKind: 'resume' })

    victim.control.close()
    attacker.control.close()
  })

  it('refuses a prototype key as an idempotency request id', async () => {
    current = await startTestRelay()
    const host = await onlineHost(current.origin)
    const invite = await createInvite(host.control, 'p1', 'device-1')
    await connectPhone(current.wsOrigin, host.identity.relayHostId, String(invite.inviteToken))
    const connOpen = await nextJson(host.control)
    host.control.send(
      JSON.stringify({
        type: 'device-credential-install',
        reqId: '__proto__',
        relayDeviceId: 'device-1',
        newResumeTokenHash: hashCredential(mintToken()),
        authorization: { mode: 'relay-basis', basisConnId: connOpen.connId }
      })
    )
    const reply = await nextJson(host.control)
    // Either refused outright or handled as an ordinary id — but never answered
    // from Object.prototype, which would send a reply with no result fields.
    expect(reply.type === 'control-error' || reply.currentVersion === 1).toBe(true)
    expect((await httpFetch(`${current.origin}/health`)).status).toBe(200)
    host.control.close()
  })
})
