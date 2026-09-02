/**
 * Restart behaviour.
 *
 * A relay that loses its state on restart is a relay that signs the desktop out
 * every time the box installs updates, and asks every phone to re-pair. Both
 * failures look like "the relay is flaky" from the outside, so they are worth
 * testing against the real snapshot on disk.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restartTestRelay, startTestRelay, type TestRelay } from './testing/harness.js'
import {
  connectPhone,
  createInvite,
  handshake,
  httpFetch,
  newHostIdentity,
  nextJson,
  relayTokenFor,
  signIn
} from './testing/client.js'
import { hashCredential, mintToken } from './shared/protocol.js'
import { CellStore } from './cell/store.js'

const dirs: string[] = []
let current: TestRelay | null = null

async function relayWithState(): Promise<TestRelay> {
  const dataDir = mkdtempSync(join(tmpdir(), 'manta-relay-'))
  dirs.push(dataDir)
  current = await startTestRelay(() => ({ dataDir }))
  return current
}

afterEach(async () => {
  await current?.stop()
  current = null
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

describe('restart durability', () => {
  it('keeps the desktop signed in across a restart', async () => {
    let relay = await relayWithState()
    const session = await signIn(relay.origin)

    relay = await restartTestRelay(relay)
    current = relay

    // Without persistence this 401s, the desktop drops to signed-out, and the
    // relay path is gated off until someone opens a browser again.
    const response = await httpFetch(`${relay.origin}/v1/desktop/auth/capabilities`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json'
      },
      body: '{}'
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      capabilities: { flags: { 'relay.use': true } }
    })
  })

  it('stores auth tokens hashed, not replayable from the snapshot', async () => {
    const relay = await relayWithState()
    const session = await signIn(relay.origin)
    await relay.relay.shutdown('flush')
    current = null

    const raw = readFileSync(join(relay.config.dataDir!, 'auth-sessions.json'), 'utf8')
    expect(raw).not.toContain(session.accessToken)
    expect(raw).not.toContain(session.refreshToken)
    expect(raw).toContain('accessHash')
  })

  it('keeps a paired phone paired across a restart', async () => {
    let relay = await relayWithState()
    const session = await signIn(relay.origin)
    const identity = newHostIdentity()
    const relayToken = await relayTokenFor(relay.origin, session.accessToken, identity.relayHostId)
    const first = await handshake({ origin: relay.origin, relayToken, identity })

    const invite = await createInvite(first.control, 'i1', 'device-1')
    await connectPhone(relay.wsOrigin, identity.relayHostId, String(invite.inviteToken))
    const connOpen = await nextJson(first.control)
    const resumeToken = mintToken()
    first.control.send(
      JSON.stringify({
        type: 'device-credential-install',
        reqId: 'install-1',
        relayDeviceId: 'device-1',
        newResumeTokenHash: hashCredential(resumeToken),
        authorization: { mode: 'relay-basis', basisConnId: connOpen.connId }
      })
    )
    expect(await nextJson(first.control)).toMatchObject({ type: 'device-credential-installed' })

    relay = await restartTestRelay(relay)
    current = relay

    // The desktop re-handshakes after a restart; the phone must not have to.
    const second = await handshake({
      origin: relay.origin,
      relayToken: await relayTokenFor(relay.origin, session.accessToken, identity.relayHostId),
      identity
    })
    expect(second.ack.type).toBe('host-hello-ack')
    const { hello } = await connectPhone(relay.wsOrigin, identity.relayHostId, resumeToken)
    expect(hello).toMatchObject({
      ok: true,
      credentialKind: 'resume',
      acceptedCredentialVersion: 1
    })
    second.control.close()
  })

  it('rotates the refresh token so a stolen snapshot cannot be reused forever', async () => {
    const relay = await relayWithState()
    const session = await signIn(relay.origin)
    const refreshed = await httpFetch(`${relay.origin}/v1/desktop/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    })
    expect(refreshed.status).toBe(200)
    const replay = await httpFetch(`${relay.origin}/v1/desktop/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    })
    expect(replay.status).toBe(401)
  })
})

describe('what the state file may contain', () => {
  it('stores the control resume secret hashed', async () => {
    // The cell only ever compares this value, so a snapshot of the file should
    // not be directly replayable as a rebind credential.
    const relay = await relayWithState()
    const session = await signIn(relay.origin)
    const identity = newHostIdentity()
    const relayToken = await relayTokenFor(relay.origin, session.accessToken, identity.relayHostId)
    const { control, ack } = await handshake({ origin: relay.origin, relayToken, identity })
    const secret = ack.controlResumeSecret as string
    control.close()
    await relay.relay.shutdown('flush')
    current = null

    const raw = readFileSync(join(relay.config.dataDir!, 'cell-state.json'), 'utf8')
    expect(raw).not.toContain(secret)
    expect(raw).toContain('controlResumeSecretHash')
  })

  it('refuses to start on a corrupt snapshot rather than silently unpairing', async () => {
    // Treating a corrupt file as empty state is the worst outcome: the next
    // scheduled flush overwrites it with that empty state, and every phone is
    // unpaired with nothing in the logs to say why.
    const relay = await relayWithState()
    const session = await signIn(relay.origin)
    const identity = newHostIdentity()
    const relayToken = await relayTokenFor(relay.origin, session.accessToken, identity.relayHostId)
    const { control } = await handshake({ origin: relay.origin, relayToken, identity })
    control.close()
    await relay.relay.shutdown('flush')
    current = null

    const file = join(relay.config.dataDir!, 'cell-state.json')
    writeFileSync(file, '{"v":1,"hosts":{"a":')
    expect(() => new CellStore(relay.config.dataDir)).toThrow(/not valid JSON/)
    // The bytes are preserved for inspection, and the next start is clean.
    expect(existsSync(`${file}.corrupt`)).toBe(true)
    expect(existsSync(file)).toBe(false)
    expect(() => new CellStore(relay.config.dataDir)).not.toThrow()
  })
})

describe('credential version floors', () => {
  it('never hands a re-paired device a version it has already retired', async () => {
    // A phone refuses a credential version it has already seen. Retiring a host
    // twice used to reset the floor to zero, so the next pairing started at v1
    // and the phone rejected the very credential it was just handed.
    const store = new CellStore(null, undefined, 'acct-legacy')
    const relayHostId = 'AbCdEf0123_-xyZ9'
    const now = Date.now()

    store.ownership.claim(relayHostId, 'acct-1', 16)
    const first = store.installCredential(
      relayHostId,
      'device-1',
      hashCredential(mintToken()),
      60_000,
      60_000,
      now,
      8
    )
    expect(first?.currentVersion).toBe(1)
    for (let round = 0; round < 3; round += 1) {
      store.ownership.release(relayHostId, 'acct-1')
      store.ownership.claim(relayHostId, 'acct-1', 16)
    }
    const reissued = store.installCredential(
      relayHostId,
      'device-1',
      hashCredential(mintToken()),
      60_000,
      60_000,
      now,
      8
    )
    expect(reissued?.currentVersion).toBeGreaterThan(first!.currentVersion)
  })

  it('does not remember a floor for a host that never issued one', () => {
    // Otherwise claim/forget is an authenticated way to grow the map for ever.
    const store = new CellStore(null, undefined, 'acct-legacy')
    for (let round = 0; round < 200; round += 1) {
      const id = `Host${String(round).padStart(12, '0')}`
      store.ownership.claim(id, 'acct-1', 1_000)
      store.ownership.release(id, 'acct-1')
    }
    expect(store.versionFloorSize).toBe(0)
  })
})

describe('a machine that has been claimed but never connected', () => {
  it('survives the sweeper, because it is the one you are looking for', () => {
    // lastSeenAt used to be stamped only by a control handshake, so a desktop
    // that signed in and published itself aged from zero and was retired on
    // the sweeper's next pass — about a minute later. The machine you want to
    // reach from another computer is exactly the one nothing has paired with.
    const store = new CellStore(null, undefined, 'acct-legacy')
    const relayHostId = 'AbCdEf0123_-xyZ9'
    expect(store.ownership.claim(relayHostId, 'acct-1', 16)).toBe('ok')
    store.ownership.describe(relayHostId, {
      displayName: 'Studio',
      platform: 'darwin',
      updatedAt: Date.now()
    })

    store.sweep(Date.now())
    expect(store.ownership.listFor('acct-1').map((host) => host.relayHostId)).toEqual([relayHostId])

    // It is still retired once it really has been quiet, which is what the
    // long window is for.
    store.sweep(Date.now() + 91 * 24 * 60 * 60_000)
    expect(store.ownership.listFor('acct-1')).toEqual([])
  })

  it('still retires an unowned record on the short window', () => {
    // An unowned record is scratch space from a handshake; nothing points at it.
    const store = new CellStore(null, undefined, '')
    store.host('BbCdEf0123_-xyZ9').lastSeenAt = Date.now()
    store.sweep(Date.now() + 2 * 60 * 60_000)
    expect(store.hostCount).toBe(1)
    store.sweep(Date.now() + 25 * 60 * 60_000)
    expect(store.hostCount).toBe(0)
  })
})
