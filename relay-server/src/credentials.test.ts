/**
 * The cell is the credential authority, so these paths decide whether a phone
 * stays paired. A wrong version, a lost grace generation, or a non-identical
 * idempotent replay all end the same way: the phone abandons the credential.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { startTestRelay, type TestRelay } from './testing/harness.js'
import { connectPhone, createInvite, nextJson, onlineHost } from './testing/client.js'
import { hashCredential, mintToken } from './shared/protocol.js'
import type WebSocket from 'ws'

const started: TestRelay[] = []

async function relayWith(overrides: Parameters<typeof startTestRelay>[0] = () => ({})) {
  const relay = await startTestRelay(overrides)
  started.push(relay)
  return relay
}

afterEach(async () => {
  while (started.length > 0) {
    await started.pop()!.stop()
  }
})

/** Pairs one phone and returns the connection the desktop can cite as basis. */
async function pair(
  relay: TestRelay,
  control: WebSocket,
  reqId: string,
  relayDeviceId: string,
  hostId: string
): Promise<{ connId: string }> {
  const invite = await createInvite(control, reqId, relayDeviceId)
  await connectPhone(relay.wsOrigin, hostId, String(invite.inviteToken))
  const connOpen = await nextJson(control)
  return { connId: String(connOpen.connId) }
}

function install(
  control: WebSocket,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  control.send(JSON.stringify({ type: 'device-credential-install', ...fields }))
  return nextJson(control)
}

describe('credential lifecycle', () => {
  it('installs a credential the phone can then resume with', async () => {
    const relay = await relayWith()
    const host = await onlineHost(relay.origin)
    const { connId } = await pair(relay, host.control, 'i1', 'device-1', host.identity.relayHostId)

    const token = mintToken()
    const installed = await install(host.control, {
      reqId: 'install-1',
      relayDeviceId: 'device-1',
      newResumeTokenHash: hashCredential(token),
      authorization: { mode: 'relay-basis', basisConnId: connId }
    })
    expect(installed).toMatchObject({
      type: 'device-credential-installed',
      v: 1,
      reqId: 'install-1',
      authorizationMode: 'relay-basis',
      currentVersion: 1
    })

    const { hello } = await connectPhone(relay.wsOrigin, host.identity.relayHostId, token)
    expect(hello).toMatchObject({
      ok: true,
      credentialKind: 'resume',
      acceptedCredentialVersion: 1,
      acceptedAs: 'current'
    })
    host.control.close()
  })

  it('keeps the previous generation usable while the phone finishes rotating', async () => {
    const relay = await relayWith()
    const host = await onlineHost(relay.origin)
    const { connId } = await pair(relay, host.control, 'i2', 'device-2', host.identity.relayHostId)

    const first = mintToken()
    await install(host.control, {
      reqId: 'install-a',
      relayDeviceId: 'device-2',
      newResumeTokenHash: hashCredential(first),
      authorization: { mode: 'relay-basis', basisConnId: connId }
    })
    const second = mintToken()
    const rotated = await install(host.control, {
      reqId: 'install-b',
      relayDeviceId: 'device-2',
      newResumeTokenHash: hashCredential(second),
      authorization: { mode: 'relay-basis', basisConnId: connId }
    })
    expect(rotated.currentVersion).toBe(2)
    expect(rotated.graceExpiresAt).toBeTypeOf('number')

    // The phone may still be holding the old token; refusing it here would make
    // it retire a credential it was never told to replace.
    const { hello } = await connectPhone(relay.wsOrigin, host.identity.relayHostId, first)
    expect(hello).toMatchObject({ ok: true, acceptedAs: 'grace', acceptedCredentialVersion: 1 })
    host.control.close()
  })

  it('replays a repeated install byte for byte', async () => {
    const relay = await relayWith()
    const host = await onlineHost(relay.origin)
    const { connId } = await pair(relay, host.control, 'i3', 'device-3', host.identity.relayHostId)
    const token = mintToken()
    const body = {
      reqId: 'install-same',
      relayDeviceId: 'device-3',
      newResumeTokenHash: hashCredential(token),
      authorization: { mode: 'relay-basis', basisConnId: connId }
    }
    const first = await install(host.control, body)
    // A second attempt with a *different* token must still replay the first
    // result: the phone compares the two and aborts its rotation on a mismatch.
    const second = await install(host.control, {
      ...body,
      newResumeTokenHash: hashCredential(mintToken())
    })
    expect(second).toEqual(first)
    host.control.close()
  })

  it('echoes the authorization mode faithfully and refuses an unknown one', async () => {
    const relay = await relayWith()
    const host = await onlineHost(relay.origin)
    await pair(relay, host.control, 'i4', 'device-4', host.identity.relayHostId)

    // The phone's direct-upgrade journal asserts on this exact string; quietly
    // defaulting it to relay-basis makes the phone abort the upgrade.
    const direct = await install(host.control, {
      reqId: 'install-direct',
      relayDeviceId: 'device-4',
      newResumeTokenHash: hashCredential(mintToken()),
      authorization: { mode: 'authenticated-direct', directAuthId: 'auth-1' }
    })
    expect(direct.authorizationMode).toBe('authenticated-direct')

    const cases = [undefined, {}, { mode: 'made-up' }, { mode: 'relay-basis' }]
    for (const [index, authorization] of cases.entries()) {
      const reply = await install(host.control, {
        // A plain identifier: reqId is a ledger key, so anything outside
        // [A-Za-z0-9._:-] is refused before it gets there.
        reqId: `bad-auth-${index}`,
        relayDeviceId: 'device-4',
        newResumeTokenHash: hashCredential(mintToken()),
        ...(authorization === undefined ? {} : { authorization })
      })
      expect(reply).toMatchObject({ type: 'control-error', code: 'invalid_install_authorization' })
    }
    host.control.close()
  })

  it('refuses a new device once the host is at its ceiling', async () => {
    const relay = await relayWith(() => ({ maxDevicesPerHost: 2 }))
    const host = await onlineHost(relay.origin)
    const { connId } = await pair(relay, host.control, 'i5', 'device-5', host.identity.relayHostId)
    const codes: string[] = []
    for (const device of ['d1', 'd2', 'd3']) {
      const reply = await install(host.control, {
        reqId: `cap-${device}`,
        relayDeviceId: device,
        newResumeTokenHash: hashCredential(mintToken()),
        authorization: { mode: 'relay-basis', basisConnId: connId }
      })
      codes.push(String(reply.code ?? reply.type))
    }
    expect(codes).toEqual([
      'device-credential-installed',
      'device-credential-installed',
      'device_limit_reached'
    ])
    host.control.close()
  })

  it('never reissues a version a phone has already seen', async () => {
    const relay = await relayWith()
    const host = await onlineHost(relay.origin)
    const { connId } = await pair(relay, host.control, 'i6', 'device-6', host.identity.relayHostId)
    const authorization = { mode: 'relay-basis', basisConnId: connId }

    const first = await install(host.control, {
      reqId: 'v1',
      relayDeviceId: 'device-6',
      newResumeTokenHash: hashCredential(mintToken()),
      authorization
    })
    host.control.send(
      JSON.stringify({ type: 'device-revoke', reqId: 'rev', relayDeviceId: 'device-6' })
    )
    expect(await nextJson(host.control)).toMatchObject({ type: 'device-revoked' })

    const reinstalled = await install(host.control, {
      reqId: 'v2',
      relayDeviceId: 'device-6',
      newResumeTokenHash: hashCredential(mintToken()),
      authorization
    })
    // Restarting at 1 would make the phone refuse the credential it was just
    // handed, because it has already recorded version 1 as spent.
    expect(reinstalled.currentVersion as number).toBeGreaterThan(first.currentVersion as number)
    host.control.close()
  })

  it('confirms a resume against the connection that cited it', async () => {
    const relay = await relayWith()
    const host = await onlineHost(relay.origin)
    const { connId } = await pair(relay, host.control, 'i7', 'device-7', host.identity.relayHostId)
    const token = mintToken()
    await install(host.control, {
      reqId: 'confirm-install',
      relayDeviceId: 'device-7',
      newResumeTokenHash: hashCredential(token),
      authorization: { mode: 'relay-basis', basisConnId: connId }
    })
    await connectPhone(relay.wsOrigin, host.identity.relayHostId, token)
    const resumeConn = await nextJson(host.control)

    host.control.send(
      JSON.stringify({
        type: 'device-resume-confirm',
        v: 1,
        reqId: 'c1',
        basisConnId: String(resumeConn.connId)
      })
    )
    expect(await nextJson(host.control)).toMatchObject({
      type: 'device-resume-confirmed',
      currentVersion: 1,
      acceptedAs: 'current'
    })

    host.control.send(
      JSON.stringify({
        type: 'device-resume-confirm',
        v: 1,
        reqId: 'c2',
        basisConnId: 'not-a-conn'
      })
    )
    expect(await nextJson(host.control)).toMatchObject({
      type: 'control-error',
      code: 'unknown_device'
    })
    host.control.close()
  })

  it('acknowledges revoking an unknown device without inventing a record for it', async () => {
    const relay = await relayWith()
    const host = await onlineHost(relay.origin)
    host.control.send(
      JSON.stringify({ type: 'device-revoke', reqId: 'r', relayDeviceId: 'never-seen' })
    )
    expect(await nextJson(host.control)).toMatchObject({ type: 'device-revoked' })
    // A stranger's id must not become a stored record, or the store grows with
    // every typo and every probe.
    expect(relay.relay.store.peekDevice(host.identity.relayHostId, 'never-seen')).toBeUndefined()
    host.control.close()
  })
})
