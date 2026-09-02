/**
 * Two desktops on one relay.
 *
 * A self-hosted deployment is normally one person's several machines — a
 * laptop and a workstation — so the relay has to keep their sessions,
 * invites, and traffic apart. The host id is sha256 of the desktop's own
 * public key, so two desktops differ by construction; what this pins is that
 * the relay actually indexes by it end to end, and that a phone paired to one
 * cannot reach the other.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import {
  connectPhone,
  createInvite,
  handshake,
  httpFetch,
  newHostIdentity,
  relayTokenFor,
  signIn
} from './testing/client.js'

let relay: TestRelay

beforeAll(async () => {
  relay = await startTestRelay()
})

afterAll(async () => {
  await relay.stop()
})

async function bringUpDesktop(accessToken: string) {
  const identity = newHostIdentity()
  const relayToken = await relayTokenFor(relay.origin, accessToken, identity.relayHostId)
  const assignment = (await (
    await httpFetch(`${relay.origin}/v1/assign`, {
      method: 'POST',
      headers: { authorization: `Bearer ${relayToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, relayHostId: identity.relayHostId })
    })
  ).json()) as { cellUrl: string; assignmentEpoch: number }
  const { control, ack } = await handshake({
    origin: relay.origin,
    relayToken,
    identity,
    assignmentEpoch: assignment.assignmentEpoch
  })
  return { identity, control, ack }
}

describe('one relay, two desktops', () => {
  it('keeps both online at once and routes each phone to its own desktop', async () => {
    // One account, two machines — the ordinary self-hosting shape.
    const session = await signIn(relay.origin)
    const laptop = await bringUpDesktop(session.accessToken)
    const workstation = await bringUpDesktop(session.accessToken)

    expect(laptop.identity.relayHostId).not.toBe(workstation.identity.relayHostId)
    expect(laptop.ack.type).toBe('host-hello-ack')
    expect(workstation.ack.type).toBe('host-hello-ack')

    // Both control legs are live: neither handshake evicted the other.
    const laptopInvite = await createInvite(laptop.control, 'r1', 'phone-a')
    const workstationInvite = await createInvite(workstation.control, 'r1', 'phone-b')
    expect(String(laptopInvite.inviteToken)).not.toBe(String(workstationInvite.inviteToken))

    // Each phone reaches the desktop that minted its invite.
    const a = await connectPhone(
      relay.wsOrigin,
      laptop.identity.relayHostId,
      String(laptopInvite.inviteToken)
    )
    const b = await connectPhone(
      relay.wsOrigin,
      workstation.identity.relayHostId,
      String(workstationInvite.inviteToken)
    )
    expect(a.hello).toMatchObject({ type: 'relay-hello', ok: true })
    expect(b.hello).toMatchObject({ type: 'relay-hello', ok: true })

    a.phone.close()
    b.phone.close()
    laptop.control.close()
    workstation.control.close()
  })

  it("refuses a phone that points its host's invite at the other desktop", async () => {
    const session = await signIn(relay.origin)
    const laptop = await bringUpDesktop(session.accessToken)
    const workstation = await bringUpDesktop(session.accessToken)
    const invite = await createInvite(laptop.control, 'r1', 'phone-c')

    // Same token, wrong host id: an invite must not be portable between hosts.
    let rejected = false
    try {
      const stray = await connectPhone(
        relay.wsOrigin,
        workstation.identity.relayHostId,
        String(invite.inviteToken)
      )
      rejected = (stray.hello as { ok?: boolean }).ok !== true
      stray.phone.close()
    } catch {
      // A closed socket is a rejection too.
      rejected = true
    }
    expect(rejected, 'an invite minted by one desktop reached the other').toBe(true)

    laptop.control.close()
    workstation.control.close()
  })
})
