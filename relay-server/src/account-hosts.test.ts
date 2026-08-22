/**
 * Accounts against a live cell.
 *
 * The HTTP-only half is covered in accounts.test.ts. These are the parts that
 * need a real host proof: two accounts' desktops proving themselves with their
 * own identity triples on the same relay, and the upgrade path for a
 * deployment whose state was written before accounts existed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestRelay, TEST_SECRET, TEST_USER, type TestRelay } from './testing/harness.js'
import { issueRelayToken } from './shared/relay-token.js'
import {
  handshake,
  httpFetch,
  nextJson,
  newHostIdentity,
  onlineHost,
  postAuth,
  register,
  relayTokenFor,
  signIn
} from './testing/client.js'

const dirs: string[] = []
let current: TestRelay | null = null

afterEach(async () => {
  await current?.stop()
  current = null
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'manta-relay-accounts-'))
  dirs.push(dir)
  return dir
}

type HostRow = { relayHostId: string; online: boolean; displayName?: string }

async function hostList(origin: string, accessToken: string): Promise<HostRow[]> {
  const response = await postAuth(origin, 'hosts', accessToken)
  expect(response.status).toBe(200)
  return ((await response.json()) as { hosts: HostRow[] }).hosts
}

describe('two accounts on one relay', () => {
  it('each proves with its own identity triple and sees only its own machines', async () => {
    current = await startTestRelay()
    const ada = await register(current.origin, {
      email: 'ada@example.com',
      password: 'correct-horse'
    })
    const bob = await register(current.origin, {
      email: 'bob@example.com',
      password: 'correct-horse'
    })
    expect(ada.user.userId).not.toBe(bob.user.userId)

    const adaHost = await onlineHost(current.origin, {
      accessToken: ada.session.accessToken,
      user: ada.user
    })
    const bobHost = await onlineHost(current.origin, {
      accessToken: bob.session.accessToken,
      user: bob.user
    })

    const adaRows = await hostList(current.origin, ada.session.accessToken)
    expect(adaRows.map((row) => row.relayHostId)).toEqual([adaHost.identity.relayHostId])
    // Online only once a control leg is actually up — the directory asks the
    // cell rather than trusting a stored flag.
    expect(adaRows[0]?.online).toBe(true)

    const bobRows = await hostList(current.origin, bob.session.accessToken)
    expect(bobRows.map((row) => row.relayHostId)).toEqual([bobHost.identity.relayHostId])

    adaHost.control.close()
    bobHost.control.close()
  })

  it('refuses a relay token for a host another account already claimed', async () => {
    current = await startTestRelay()
    const ada = await register(current.origin, {
      email: 'ada@example.com',
      password: 'correct-horse'
    })
    const bob = await register(current.origin, {
      email: 'bob@example.com',
      password: 'correct-horse'
    })
    const host = await onlineHost(current.origin, {
      accessToken: ada.session.accessToken,
      user: ada.user
    })

    const response = await postAuth(current.origin, 'relay-token', bob.session.accessToken, {
      relayHostId: host.identity.relayHostId
    })
    expect(response.status).toBe(403)
    host.control.close()
  })

  it('reports a machine offline once its control leg is gone', async () => {
    current = await startTestRelay()
    const ada = await register(current.origin, {
      email: 'ada@example.com',
      password: 'correct-horse'
    })
    const host = await onlineHost(current.origin, {
      accessToken: ada.session.accessToken,
      user: ada.user
    })
    expect((await hostList(current.origin, ada.session.accessToken))[0]?.online).toBe(true)

    await new Promise<void>((resolve) => {
      host.control.once('close', () => resolve())
      host.control.close()
    })
    // A session in its rebind grace window is not reachable, whatever the map
    // still holds.
    expect((await hostList(current.origin, ada.session.accessToken))[0]?.online).toBe(false)
  })
})

describe('a proven control leg', () => {
  it('refuses an auth-refresh that would change subject mid-session', async () => {
    // The host proof was built against the identity in the *original* token and
    // is never rebuilt, so accepting a refreshed token with a different subject
    // would silently re-label an already-proven session as somebody else's.
    current = await startTestRelay()
    const ada = await register(current.origin, {
      email: 'ada@example.com',
      password: 'correct-horse'
    })
    const host = await onlineHost(current.origin, {
      accessToken: ada.session.accessToken,
      user: ada.user
    })

    const forged = issueRelayToken(
      {
        userId: 'someone-else',
        profileId: ada.user.profileId,
        organizationId: '',
        relayHostId: host.identity.relayHostId,
        expiresAt: Date.now() + 60_000
      },
      TEST_SECRET
    )
    const reply = nextJson(host.control)
    host.control.send(JSON.stringify({ type: 'auth-refresh', relayJwt: forged }))
    expect(await reply).toMatchObject({ type: 'control-error', code: 'invalid_relay_token' })
    host.control.close()
  })

  it('accepts an auth-refresh that keeps the same subject', async () => {
    current = await startTestRelay()
    const ada = await register(current.origin, {
      email: 'ada@example.com',
      password: 'correct-horse'
    })
    const host = await onlineHost(current.origin, {
      accessToken: ada.session.accessToken,
      user: ada.user
    })
    const renewed = await relayTokenFor(
      current.origin,
      ada.session.accessToken,
      host.identity.relayHostId
    )
    host.control.send(JSON.stringify({ type: 'auth-refresh', relayJwt: renewed }))
    // Silence is the success signal here; a refusal arrives as control-error.
    // Prove the leg is still usable by asking it for something.
    const reply = nextJson(host.control)
    host.control.send(JSON.stringify({ type: 'not-a-real-request', reqId: 'r1' }))
    expect(await reply).toMatchObject({ type: 'control-error', code: 'unsupported_request' })
    host.control.close()
  })
})

describe('upgrading a relay that predates accounts', () => {
  it('adopts existing sessions and host records under the legacy account', async () => {
    const dataDir = tempDir()
    // A v1 snapshot: no accountId on the session, no owner on the host.
    const relayHostId = newHostIdentity().relayHostId
    writeFileSync(
      join(dataDir, 'cell-state.json'),
      JSON.stringify({
        v: 1,
        hosts: {
          [relayHostId]: {
            relayHostId,
            devices: {},
            invites: {},
            installLedger: {},
            generation: 3,
            maxCredentialVersion: 7,
            lastSeenAt: Date.now()
          }
        }
      })
    )
    current = await startTestRelay(() => ({ dataDir }))

    // The enrolment path every desktop in the field uses still grants a
    // session, and it lands on the legacy account.
    const session = await signIn(current.origin)
    const rows = await hostList(current.origin, session.accessToken)
    expect(rows.map((row) => row.relayHostId)).toEqual([relayHostId])

    // A brand-new account must not be able to take the adopted host over.
    const bob = await register(current.origin, {
      email: 'bob@example.com',
      password: 'correct-horse'
    })
    const stolen = await postAuth(current.origin, 'relay-token', bob.session.accessToken, {
      relayHostId
    })
    expect(stolen.status).toBe(403)
  })

  it('keeps serving the environment identity triple to the legacy account', async () => {
    // Every already-paired desktop compares these three strings byte-for-byte
    // inside the host proof; changing them is an undiagnosable 4401.
    current = await startTestRelay()
    const session = await signIn(current.origin)
    const identity = newHostIdentity()
    const relayToken = await relayTokenFor(
      current.origin,
      session.accessToken,
      identity.relayHostId
    )
    const { ack, control } = await handshake({
      origin: current.origin,
      relayToken,
      identity,
      user: TEST_USER
    })
    expect(ack.type).toBe('host-hello-ack')
    control.close()
  })

  it('still answers the identity envelope with relay.use', async () => {
    current = await startTestRelay()
    const session = await signIn(current.origin)
    const response = await httpFetch(`${current.origin}/v1/desktop/auth/capabilities`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json'
      },
      body: '{}'
    })
    expect(await response.json()).toMatchObject({
      cloud: { userId: TEST_USER.userId, cloudProfileId: TEST_USER.profileId },
      capabilities: { flags: { 'relay.use': true } }
    })
  })
})
