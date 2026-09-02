/**
 * Every control frame the cell emits, parsed by the desktop's own zod schemas.
 *
 * Those schemas are `.strict()`: one extra field and the client discards the
 * whole message. Because a discarded message is silence rather than an error,
 * the symptom is a request that never resolves — which is why this is checked
 * against the real schemas rather than against a written-down contract.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ZodTypeAny } from 'zod'
import {
  RelayConnectionOpenMessageSchema,
  RelayControlErrorMessageSchema,
  RelayDeviceCredentialInstallStatusResultMessageSchema,
  RelayDeviceCredentialInstalledMessageSchema,
  RelayDeviceResumeConfirmedMessageSchema,
  RelayDeviceRevokedMessageSchema,
  RelayDrainMessageSchema,
  RelayHostChallengeMessageSchema,
  RelayHostHelloAckMessageSchema,
  RelayInviteCreatedMessageSchema,
  RelayPingMessageSchema
} from '../../src/main/runtime/relay/relay-control-protocol'
import { RelayPhoneHelloSchema } from '../../src/shared/mobile-relay-phone-protocol'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import { connectPhone, createInvite, nextJson, onlineHost } from './testing/client.js'
import { hashCredential, mintToken } from './shared/protocol.js'

const SCHEMAS: Record<string, ZodTypeAny> = {
  'host-challenge': RelayHostChallengeMessageSchema,
  'host-hello-ack': RelayHostHelloAckMessageSchema,
  'conn-open': RelayConnectionOpenMessageSchema,
  drain: RelayDrainMessageSchema,
  ping: RelayPingMessageSchema,
  'invite-created': RelayInviteCreatedMessageSchema,
  'device-revoked': RelayDeviceRevokedMessageSchema,
  'device-credential-installed': RelayDeviceCredentialInstalledMessageSchema,
  'device-credential-install-status-result': RelayDeviceCredentialInstallStatusResultMessageSchema,
  'device-resume-confirmed': RelayDeviceResumeConfirmedMessageSchema,
  'control-error': RelayControlErrorMessageSchema
}

/**
 * Asserts through the same gate the desktop uses, and says what failed.
 *
 * `expected` matters: picking the schema from whatever type came back would
 * pass for any well-formed frame, including the wrong one — a control-error
 * where an invite was requested would sail through.
 */
function expectAccepted(message: Record<string, unknown>, expected: string): void {
  const type = String(message.type)
  expect(type, `expected a ${expected} frame`).toBe(expected)
  const schema = SCHEMAS[type]
  expect(schema, `no client schema for control message '${type}'`).toBeDefined()
  const parsed = schema!.safeParse(message)
  expect(
    parsed.success ? null : `${type}: ${JSON.stringify(parsed.error!.issues)}`,
    `the desktop would discard this ${type}`
  ).toBeNull()
}

/** The phone's gate. A refusal it cannot parse becomes a generic error. */
function expectPhoneAccepts(hello: Record<string, unknown>): void {
  const parsed = RelayPhoneHelloSchema.safeParse(hello)
  expect(
    parsed.success ? null : `relay-hello: ${JSON.stringify(parsed.error!.issues)}`,
    'the phone would discard this relay-hello'
  ).toBeNull()
}

let current: TestRelay | null = null

afterEach(async () => {
  await current?.stop()
  current = null
})

describe('control frames the desktop will accept', () => {
  it('accepts the handshake, invite, and connection-open frames', async () => {
    current = await startTestRelay()
    const host = await onlineHost(current.origin)
    expectAccepted(host.ack, 'host-hello-ack')

    const invite = await createInvite(host.control, 'req-1', 'device-1')
    expectAccepted(invite, 'invite-created')

    await connectPhone(current.wsOrigin, host.identity.relayHostId, String(invite.inviteToken))
    expectAccepted(await nextJson(host.control), 'conn-open')
    host.control.close()
  })

  it('accepts every credential frame, including the error replies', async () => {
    current = await startTestRelay()
    const host = await onlineHost(current.origin)
    const invite = await createInvite(host.control, 'req-2', 'device-2')
    await connectPhone(current.wsOrigin, host.identity.relayHostId, String(invite.inviteToken))
    const connOpen = await nextJson(host.control)

    const token = mintToken()
    host.control.send(
      JSON.stringify({
        type: 'device-credential-install',
        reqId: 'install-1',
        relayDeviceId: 'device-2',
        newResumeTokenHash: hashCredential(token),
        authorization: { mode: 'relay-basis', basisConnId: connOpen.connId }
      })
    )
    expectAccepted(await nextJson(host.control), 'device-credential-installed')

    host.control.send(
      JSON.stringify({
        type: 'device-credential-install-status',
        reqId: 'install-1',
        relayDeviceId: 'device-2'
      })
    )
    expectAccepted(await nextJson(host.control), 'device-credential-install-status-result')

    await connectPhone(current.wsOrigin, host.identity.relayHostId, token)
    const resumeConn = await nextJson(host.control)
    host.control.send(
      JSON.stringify({
        type: 'device-resume-confirm',
        v: 1,
        reqId: 'confirm-1',
        basisConnId: resumeConn.connId
      })
    )
    expectAccepted(await nextJson(host.control), 'device-resume-confirmed')

    host.control.send(
      JSON.stringify({ type: 'device-revoke', reqId: 'rev-1', relayDeviceId: 'device-2' })
    )
    expectAccepted(await nextJson(host.control), 'device-revoked')

    // Error replies go through the same strict gate; an extra diagnostic field
    // here would make the desktop drop the reply and hang on its own timeout.
    host.control.send(JSON.stringify({ type: 'nonsense-request', reqId: 'bad-1' }))
    expectAccepted(await nextJson(host.control), 'control-error')

    host.control.send(
      JSON.stringify({
        type: 'device-credential-install',
        reqId: 'bad-auth',
        relayDeviceId: 'device-2',
        newResumeTokenHash: hashCredential(mintToken()),
        authorization: { mode: 'made-up' }
      })
    )
    expectAccepted(await nextJson(host.control), 'control-error')
    host.control.close()
  })

  it('accepts the rate-limit refusal on the control leg', async () => {
    current = await startTestRelay(() => ({
      limits: { controlBurst: 1, controlPerSecond: 0.001 }
    }))
    const host = await onlineHost(current.origin)
    await createInvite(host.control, 'ok-1', 'device-1')
    const refused = await createInvite(host.control, 'refused-1', 'device-1')
    expect(refused.code).toBe('rate_limited')
    expectAccepted(refused, 'control-error')
    host.control.close()
  })

  it('accepts the drain frame', async () => {
    current = await startTestRelay(() => ({ shutdownGraceMs: 100 }))
    const host = await onlineHost(current.origin)
    const drain = nextJson(host.control)
    const stopping = current.relay.shutdown('test')
    expectAccepted(await drain, 'drain')
    await stopping
    current = null
  })

  it('never reports more connections than the desktop schema admits', async () => {
    // activeConnIds and pendingConns are capped at 8 by the client schema, so a
    // ninth pending connection would make the *entire* host-hello-ack fail to
    // parse — turning the next lease rebind into a full reconnect for everyone.
    current = await startTestRelay(() => ({ attachDeadlineMs: 30_000 }))
    const host = await onlineHost(current.origin)
    for (let index = 0; index < 12; index += 1) {
      const invite = await createInvite(host.control, `many-${index}`, `device-${index}`)
      if (invite.type !== 'invite-created') {
        break
      }
      const { hello } = await connectPhone(
        current.wsOrigin,
        host.identity.relayHostId,
        String(invite.inviteToken)
      )
      if (hello.ok !== true) {
        break
      }
      await nextJson(host.control)
    }
    expect(host.control.readyState).toBe(host.control.OPEN)
    const pending = (
      current.relay.cell as unknown as { sessions: Map<string, { pending: Map<string, unknown> }> }
    ).sessions.get(host.identity.relayHostId)!.pending.size
    expect(pending).toBeLessThanOrEqual(8)
    host.control.close()
  })
})

describe('relay-hello frames the phone will accept', () => {
  it('accepts the invite and resume greetings', async () => {
    current = await startTestRelay()
    const host = await onlineHost(current.origin)
    const invite = await createInvite(host.control, 'ph-1', 'device-1')
    const first = await connectPhone(
      current.wsOrigin,
      host.identity.relayHostId,
      String(invite.inviteToken)
    )
    expectPhoneAccepts(first.hello)
    const connOpen = await nextJson(host.control)

    const token = mintToken()
    host.control.send(
      JSON.stringify({
        type: 'device-credential-install',
        reqId: 'ph-install',
        relayDeviceId: 'device-1',
        newResumeTokenHash: hashCredential(token),
        authorization: { mode: 'relay-basis', basisConnId: connOpen.connId }
      })
    )
    await nextJson(host.control)
    const second = await connectPhone(current.wsOrigin, host.identity.relayHostId, token)
    expectPhoneAccepts(second.hello)
    host.control.close()
  })

  it('accepts every refusal, including the rate-limited one', async () => {
    // A refusal the phone cannot parse turns into 'invalid relay hello', and it
    // loses the code that tells it whether to back off, retry, or re-resolve.
    current = await startTestRelay(() => ({ limits: { phoneBurst: 1, phonePerSecond: 0.001 } }))
    const host = await onlineHost(current.origin)

    const bad = await connectPhone(current.wsOrigin, host.identity.relayHostId, 'q'.repeat(43))
    expectPhoneAccepts(bad.hello)

    const limited = await connectPhone(current.wsOrigin, host.identity.relayHostId, 'q'.repeat(43))
    expect(limited.hello.code).toBe(4429)
    expectPhoneAccepts(limited.hello)
    host.control.close()
  })

  it('accepts the draining refusal', async () => {
    current = await startTestRelay(() => ({ shutdownGraceMs: 200 }))
    const host = await onlineHost(current.origin)
    const invite = await createInvite(host.control, 'ph-2', 'device-2')
    const stopping = current.relay.shutdown('test')
    const { hello } = await connectPhone(
      current.wsOrigin,
      host.identity.relayHostId,
      String(invite.inviteToken)
    )
    expect(hello.code).toBe(4503)
    expectPhoneAccepts(hello)
    await stopping
    current = null
  })
})
