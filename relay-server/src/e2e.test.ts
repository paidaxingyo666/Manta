/**
 * End-to-end: a real desktop handshake (using the client's own proof code),
 * an invite, a phone attaching with it, and bytes flowing both ways.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import {
  attachData,
  connectPhone,
  createInvite,
  handshake,
  httpFetch,
  newHostIdentity,
  nextClose,
  nextJson,
  onlineHost,
  open,
  relayTokenFor,
  signIn
} from './testing/client.js'
import { deriveRelayHostId } from './shared/protocol.js'

let relay: TestRelay

beforeAll(async () => {
  relay = await startTestRelay()
})

afterAll(async () => {
  await relay.stop()
})

describe('self-hosted relay end to end', () => {
  it('carries bytes between a desktop and a phone', async () => {
    // 1. Sign in through the real authorize -> session exchange.
    const session = await signIn(relay.origin)
    expect(session.accessToken).toBeTruthy()

    const identity = newHostIdentity()
    const relayToken = await relayTokenFor(relay.origin, session.accessToken, identity.relayHostId)
    expect(relayToken).toBeTruthy()

    // 2. Ask the director where to connect.
    const assignment = (await (
      await httpFetch(`${relay.origin}/v1/assign`, {
        method: 'POST',
        headers: { authorization: `Bearer ${relayToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, relayHostId: identity.relayHostId })
      })
    ).json()) as { cellUrl: string; assignmentEpoch: number; lease: string }
    expect(assignment.cellUrl).toBe(relay.origin)
    expect(assignment.lease).toBeTruthy()

    // 3. Control leg handshake, answered by the real client implementation.
    const { control, ack } = await handshake({
      origin: relay.origin,
      relayToken,
      identity,
      assignmentEpoch: assignment.assignmentEpoch
    })
    expect(ack.type).toBe('host-hello-ack')
    const generation = ack.generation as number
    expect(generation).toBeGreaterThan(0)

    // 4. Mint an invite for a phone.
    const invite = await createInvite(control, 'r1', 'device-1')
    expect(invite.type).toBe('invite-created')
    expect(String(invite.inviteToken)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // A phone refuses an invite valid for more than ten minutes.
    expect((invite.expiresAt as number) - Date.now()).toBeLessThanOrEqual(10 * 60_000 + 1_000)

    // 5. Phone connects with the invite.
    const { phone, hello } = await connectPhone(
      relay.wsOrigin,
      identity.relayHostId,
      String(invite.inviteToken)
    )
    expect(hello).toMatchObject({ type: 'relay-hello', ok: true, credentialKind: 'invite' })

    // 6. The desktop is told to attach a data leg.
    const connOpen = await nextJson(control)
    expect(connOpen.type).toBe('conn-open')
    expect(connOpen.kind).toBe('invite')
    const data = await attachData(relay.wsOrigin, connOpen, generation)

    // 7. Bytes flow both ways, preserving the binary flag.
    const phoneGot = new Promise<Buffer>((resolve) =>
      phone.once('message', (d) => resolve(d as Buffer))
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    data.send(Buffer.from([1, 2, 3]), { binary: true })
    expect(Buffer.from(await phoneGot)).toEqual(Buffer.from([1, 2, 3]))

    const hostGot = new Promise<Buffer>((resolve) =>
      data.once('message', (d) => resolve(d as Buffer))
    )
    phone.send(Buffer.from([9, 8]), { binary: true })
    expect(Buffer.from(await hostGot)).toEqual(Buffer.from([9, 8]))

    for (const socket of [control, phone, data]) {
      socket.close()
    }
  })

  it('tells a phone whose host is offline to retry, not to burn its credential', async () => {
    const phone = await open(new WebSocket(`${relay.wsOrigin}/v1/connect/${'a'.repeat(16)}`))
    const closed = nextClose(phone)
    phone.send(
      JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential: 'x'.repeat(43) })
    )
    // No host is online for that id, so the phone is told to retry later.
    expect(await closed).toBe(4404)
  })

  it('delivers frames the phone sent before the desktop attached', async () => {
    // The real phone starts its E2EE handshake in the same microtask it receives
    // relay-hello, long before the desktop can open a data leg. Those frames must
    // be buffered and replayed in order — dropping the first one deadlocks the
    // handshake forever.
    const host = await onlineHost(relay.origin)
    const invite = await createInvite(host.control, 'r2', 'device-2')
    const { phone } = await connectPhone(
      relay.wsOrigin,
      host.identity.relayHostId,
      String(invite.inviteToken)
    )

    // Fire immediately, exactly like the E2EE hello does.
    phone.send(Buffer.from([0xe1, 0xe2]), { binary: true })
    phone.send('text-before-attach')

    const connOpen = await nextJson(host.control)
    const data = await open(
      new WebSocket(`${relay.wsOrigin}/v1/host/data/${encodeURIComponent(String(connOpen.connId))}`)
    )

    const received: { text: boolean; body: string }[] = []
    const gotBoth = new Promise<void>((resolve) => {
      data.on('message', (raw, isBinary) => {
        received.push({ text: !isBinary, body: Buffer.from(raw as Buffer).toString('hex') })
        if (received.length === 2) {
          resolve()
        }
      })
    })
    data.send(
      JSON.stringify({
        type: 'host-data-auth',
        v: 1,
        connTicket: connOpen.connTicket,
        generation: host.generation
      })
    )
    await gotBoth

    // Order and the binary flag must both survive the replay.
    expect(received[0]).toEqual({ text: false, body: 'e1e2' })
    expect(received[1]?.text).toBe(true)
    expect(Buffer.from(received[1]!.body, 'hex').toString('utf8')).toBe('text-before-attach')

    for (const socket of [host.control, phone, data]) {
      socket.close()
    }
  })

  it('reuses the session on a lease rebind instead of replacing it', async () => {
    // The desktop rebinds every ~9 minutes on a brand new socket. The client
    // asserts the generation is unchanged and that its connections come back;
    // allocating a new generation here would kick every phone each cycle.
    const host = await onlineHost(relay.origin)
    const resumeSecret = host.ack.controlResumeSecret as string
    expect(resumeSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // Leave a phone waiting so the rebind has something to bring back.
    const invite = await createInvite(host.control, 'r3', 'device-3')
    const { phone } = await connectPhone(
      relay.wsOrigin,
      host.identity.relayHostId,
      String(invite.inviteToken)
    )
    const connOpen = await nextJson(host.control)

    const second = await handshake({
      origin: relay.origin,
      relayToken: host.relayToken,
      identity: host.identity,
      previousGeneration: host.generation,
      controlResumeSecret: resumeSecret
    })
    expect(second.ack.type).toBe('host-hello-ack')
    expect(second.ack.generation).toBe(host.generation)
    expect(second.ack.pendingConns).toEqual([
      { connId: connOpen.connId, connTicket: connOpen.connTicket }
    ])
    // A rotated secret must come back so the next rebind can authenticate.
    expect(second.ack.controlResumeSecret).not.toBe(resumeSecret)

    for (const socket of [host.control, second.control, phone]) {
      socket.close()
    }
  })

  it('keeps phones attached when the old control leg closes mid-rebind', async () => {
    // The replacement leg arrives on a new socket while the old one is still
    // closing. Tearing the session down on that close would kick every phone
    // and then leave the rebind with nothing to resume — so it would be refused
    // too, and the desktop would fall back to a full reconnect every cycle.
    const host = await onlineHost(relay.origin)
    const resumeSecret = host.ack.controlResumeSecret as string
    const invite = await createInvite(host.control, 'race-1', 'device-race')
    const { phone } = await connectPhone(
      relay.wsOrigin,
      host.identity.relayHostId,
      String(invite.inviteToken)
    )
    const connOpen = await nextJson(host.control)
    const data = await attachData(relay.wsOrigin, connOpen, host.generation)

    let phoneClosedWith: number | null = null
    phone.once('close', (code) => {
      phoneClosedWith = code
    })
    // Close first, rebind second: the order that loses the race.
    host.control.close()
    const rebound = await handshake({
      origin: relay.origin,
      relayToken: host.relayToken,
      identity: host.identity,
      previousGeneration: host.generation,
      controlResumeSecret: resumeSecret
    })
    expect(rebound.ack.type).toBe('host-hello-ack')
    expect(rebound.ack.generation).toBe(host.generation)
    expect(rebound.ack.activeConnIds).toEqual([connOpen.connId])
    expect(phoneClosedWith).toBeNull()

    // And the pair still carries bytes afterwards.
    const got = new Promise<Buffer>((resolve) => data.once('message', (d) => resolve(d as Buffer)))
    phone.send(Buffer.from([5, 5]), { binary: true })
    expect(Buffer.from(await got)).toEqual(Buffer.from([5, 5]))

    for (const socket of [rebound.control, phone, data]) {
      socket.close()
    }
  })

  it('rejects a rebind carrying the wrong resume secret with 4401', async () => {
    const host = await onlineHost(relay.origin)
    const control = await open(
      new WebSocket(`${relay.wsOrigin}/v1/host/control`, {
        headers: { authorization: `Bearer ${host.relayToken}` }
      })
    )
    const closed = nextClose(control)
    const { identity } = host
    control.send(
      JSON.stringify({
        type: 'host-hello',
        v: 1,
        relayHostId: identity.relayHostId,
        assignmentEpoch: 1,
        hostPublicKeyB64: identity.hostPublicKey.toString('base64'),
        appVersion: 'test',
        previousGeneration: host.generation,
        controlResumeSecret: 'x'.repeat(43)
      })
    )
    const challenge = await nextJson(control)
    const { answerRelayHostChallenge } =
      await import('../../src/main/runtime/relay/relay-host-proof')
    const proof = answerRelayHostChallenge(challenge as never, {
      relayOrigin: relay.origin,
      userId: relay.config.user.userId,
      profileId: relay.config.user.profileId,
      organizationId: relay.config.user.organizationId,
      relayHostId: identity.relayHostId,
      hostPublicKey: identity.hostPublicKey,
      hostSecretKey: identity.hostSecretKey,
      assignmentEpoch: 1,
      previousGeneration: host.generation,
      resumeRequested: true
    })
    control.send(
      JSON.stringify({
        type: 'host-challenge-ack',
        challengeId: challenge.challengeId,
        proofB64: proof
      })
    )
    // The client has a dedicated recovery path for 4401 here: open a fresh
    // origin with previousGeneration undefined.
    expect(await closed).toBe(4401)
    host.control.close()
  })

  it('refuses a relay host id that is not derived from the host key', async () => {
    const session = await signIn(relay.origin)
    const identity = newHostIdentity()
    const other = nacl.box.keyPair()
    // A token minted for a foreign id, replayed with the attacker's own key.
    const victimHostId = deriveRelayHostId(Buffer.from(other.publicKey))
    const relayToken = await relayTokenFor(relay.origin, session.accessToken, victimHostId)

    const control = await open(
      new WebSocket(`${relay.wsOrigin}/v1/host/control`, {
        headers: { authorization: `Bearer ${relayToken}` }
      })
    )
    const closed = nextClose(control)
    control.send(
      JSON.stringify({
        type: 'host-hello',
        v: 1,
        relayHostId: victimHostId,
        assignmentEpoch: 1,
        hostPublicKeyB64: identity.hostPublicKey.toString('base64'),
        appVersion: 'test'
      })
    )
    expect(await closed).toBe(4401)
  })

  it('refuses a second host-hello on one socket instead of orphaning the session', async () => {
    const host = await onlineHost(relay.origin)
    const closed = nextClose(host.control)
    host.control.send(
      JSON.stringify({
        type: 'host-hello',
        v: 1,
        relayHostId: host.identity.relayHostId,
        assignmentEpoch: 1,
        hostPublicKeyB64: host.identity.hostPublicKey.toString('base64'),
        appVersion: 'test'
      })
    )
    expect(await closed).toBe(1008)
  })
})
