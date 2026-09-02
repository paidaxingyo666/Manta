/**
 * Accounts.
 *
 * The relay used to serve one identity read straight from the environment.
 * These cover the parts that replaced it: registering, signing in, and the fact
 * that a host id belongs to exactly one account once it has been claimed.
 *
 * Deliberately HTTP-only so it runs in the standalone suite the release
 * workflow uses — nothing here needs the desktop's protocol code.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PER_USER, startTestRelay, type TestRelay } from './testing/harness.js'
import { hashToken } from './auth/store.js'
import { createRelay } from './relay.js'
import { Logger } from './shared/log.js'

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
  const dir = mkdtempSync(join(tmpdir(), 'manta-relay-accounts-http-'))
  dirs.push(dir)
  return dir
}

function post(origin: string, endpoint: string, body: unknown, accessToken?: string) {
  return fetch(`${origin}/v1/desktop/auth/${endpoint}`, {
    method: 'POST',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  })
}

type SessionBody = {
  accessToken: string
  refreshToken: string
  cloud: { userId: string; cloudProfileId: string; email: string }
  capabilities: { flags: Record<string, boolean> }
}

async function registerAccount(origin: string, email: string, extra: unknown = {}) {
  const response = await post(origin, 'register', { email, password: 'correct-horse', ...extra })
  if (!response.ok) {
    throw new Error(`register failed: ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as SessionBody
}

/** A well-formed id: 16 base64url characters, as derived from a host key. */
const HOST_A = 'AAAAAAAAAAAAAAAA'
const HOST_B = 'BBBBBBBBBBBBBBBB'

describe('registration', () => {
  it('mints an identity of its own, not the environment one', async () => {
    current = await startTestRelay(() => PER_USER)
    const session = await registerAccount(current.origin, 'ada@example.com')
    // The identity triple is signed byte-for-byte into every host proof, so an
    // account that reused the legacy one would let two people's desktops prove
    // themselves as each other.
    expect(session.cloud.userId).not.toBe('user-1')
    expect(session.cloud.cloudProfileId).not.toBe('profile-1')
    expect(session.cloud.email).toBe('ada@example.com')
    // Without relay.use the desktop never opens a relay broker at all.
    expect(session.capabilities.flags['relay.use']).toBe(true)
    expect(session.accessToken).toBeTruthy()
  })

  it('refuses a second account on the same address, however it is cased', async () => {
    current = await startTestRelay(() => PER_USER)
    await registerAccount(current.origin, 'ada@example.com')
    const again = await post(current.origin, 'register', {
      email: 'ADA@Example.com',
      password: 'correct-horse'
    })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ error: 'email_taken' })
  })

  it('refuses a password short enough to grind', async () => {
    current = await startTestRelay(() => PER_USER)
    const response = await post(current.origin, 'register', {
      email: 'ada@example.com',
      password: 'short'
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'weak_password' })
  })

  it('inherits the enrolment secret as its gate when one is configured', async () => {
    // A relay with a secret is reachable from the internet; open signup there
    // would hand a stranger a relay token and a control leg.
    current = await startTestRelay(() => ({
      ...PER_USER,
      enrollmentSecret: 'open-sesame',
      registrationMode: 'enrollment-secret'
    }))
    const refused = await post(current.origin, 'register', {
      email: 'ada@example.com',
      password: 'correct-horse'
    })
    expect(refused.status).toBe(401)
    const allowed = await post(current.origin, 'register', {
      email: 'ada@example.com',
      password: 'correct-horse',
      enrollmentSecret: 'open-sesame'
    })
    expect(allowed.status).toBe(200)
  })

  it('can be closed entirely', async () => {
    current = await startTestRelay(() => ({
      ...PER_USER,
      registrationMode: 'disabled'
    }))
    const response = await post(current.origin, 'register', {
      email: 'ada@example.com',
      password: 'correct-horse'
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'registration_disabled' })
  })
})

describe('sign-in', () => {
  it('returns the same identity the account registered with', async () => {
    current = await startTestRelay(() => PER_USER)
    const registered = await registerAccount(current.origin, 'ada@example.com')
    const response = await post(current.origin, 'login', {
      email: 'ADA@example.com ',
      password: 'correct-horse'
    })
    expect(response.status).toBe(200)
    const session = (await response.json()) as SessionBody
    expect(session.cloud.userId).toBe(registered.cloud.userId)
    expect(session.accessToken).not.toBe(registered.accessToken)
  })

  it('says the same thing for a wrong password and an unknown address', async () => {
    current = await startTestRelay(() => PER_USER)
    await registerAccount(current.origin, 'ada@example.com')
    for (const body of [
      { email: 'ada@example.com', password: 'wrong-horse' },
      { email: 'nobody@example.com', password: 'correct-horse' }
    ]) {
      const response = await post(current.origin, 'login', body)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ error: 'invalid_credentials' })
    }
  })

  it('keeps a refreshed session on the same account', async () => {
    current = await startTestRelay(() => PER_USER)
    const registered = await registerAccount(current.origin, 'ada@example.com')
    const response = await post(current.origin, 'refresh', {
      refreshToken: registered.refreshToken
    })
    expect(response.status).toBe(200)
    const refreshed = (await response.json()) as SessionBody
    expect(refreshed.cloud.userId).toBe(registered.cloud.userId)
    // Rotated: leaving the old one usable means a stolen state file grants
    // sessions forever.
    const replay = await post(current.origin, 'refresh', { refreshToken: registered.refreshToken })
    expect(replay.status).toBe(401)
  })
})

describe('host ownership', () => {
  it('claims a host id on first use and refuses every other account after', async () => {
    current = await startTestRelay(() => PER_USER)
    const ada = await registerAccount(current.origin, 'ada@example.com')
    const bob = await registerAccount(current.origin, 'bob@example.com')

    expect(
      (await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)).status
    ).toBe(200)
    // Idempotent for the owner: a desktop mints a fresh token every hour.
    expect(
      (await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)).status
    ).toBe(200)

    const stolen = await post(
      current.origin,
      'relay-token',
      { relayHostId: HOST_A },
      bob.accessToken
    )
    expect(stolen.status).toBe(403)
    expect(await stolen.json()).toMatchObject({ error: 'host_owned_by_another_account' })
  })

  it('bounds how many machines one account can register', async () => {
    current = await startTestRelay(() => ({
      ...PER_USER,
      maxHostsPerAccount: 1
    }))
    const ada = await registerAccount(current.origin, 'ada@example.com')
    expect(
      (await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)).status
    ).toBe(200)
    const second = await post(
      current.origin,
      'relay-token',
      { relayHostId: HOST_B },
      ada.accessToken
    )
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: 'too_many_hosts' })
  })
})

describe('machine directory', () => {
  it('lists only the caller account\u2019s machines', async () => {
    current = await startTestRelay(() => PER_USER)
    const ada = await registerAccount(current.origin, 'ada@example.com')
    const bob = await registerAccount(current.origin, 'bob@example.com')
    await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)
    await post(current.origin, 'relay-token', { relayHostId: HOST_B }, bob.accessToken)

    const listed = (await (await post(current.origin, 'hosts', {}, ada.accessToken)).json()) as {
      hosts: { relayHostId: string; online: boolean }[]
    }
    expect(listed.hosts.map((host) => host.relayHostId)).toEqual([HOST_A])
    // Claimed but never connected: the directory must not report it reachable.
    expect(listed.hosts[0]?.online).toBe(false)
  })

  it('takes a label from the owner and refuses one from anybody else', async () => {
    current = await startTestRelay(() => PER_USER)
    const ada = await registerAccount(current.origin, 'ada@example.com')
    const bob = await registerAccount(current.origin, 'bob@example.com')
    await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)

    expect(
      (
        await post(
          current.origin,
          'host-describe',
          { relayHostId: HOST_A, displayName: "Ada's laptop", platform: 'darwin' },
          ada.accessToken
        )
      ).status
    ).toBe(200)
    expect(
      (
        await post(
          current.origin,
          'host-describe',
          { relayHostId: HOST_A, displayName: 'stolen' },
          bob.accessToken
        )
      ).status
    ).toBe(403)

    const listed = (await (await post(current.origin, 'hosts', {}, ada.accessToken)).json()) as {
      hosts: { displayName?: string; platform?: string }[]
    }
    // Control characters would travel straight into a renderer list row.
    expect(listed.hosts[0]?.displayName).toBe("Ada's laptop")
    expect(listed.hosts[0]?.platform).toBe('darwin')
  })

  it('forgets a machine, and only for its owner', async () => {
    current = await startTestRelay(() => PER_USER)
    const ada = await registerAccount(current.origin, 'ada@example.com')
    const bob = await registerAccount(current.origin, 'bob@example.com')
    await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)

    expect(
      (await post(current.origin, 'host-forget', { relayHostId: HOST_A }, bob.accessToken)).status
    ).toBe(404)
    expect(
      (await post(current.origin, 'host-forget', { relayHostId: HOST_A }, ada.accessToken)).status
    ).toBe(200)

    const listed = (await (await post(current.origin, 'hosts', {}, ada.accessToken)).json()) as {
      hosts: unknown[]
    }
    expect(listed.hosts).toEqual([])
    // Released, so the id is claimable again — by anyone who holds its key.
    expect(
      (await post(current.origin, 'relay-token', { relayHostId: HOST_A }, bob.accessToken)).status
    ).toBe(200)
  })

  it('refuses every account endpoint without a bearer', async () => {
    current = await startTestRelay(() => PER_USER)
    for (const endpoint of ['hosts', 'host-describe', 'host-forget', 'relay-token']) {
      expect((await post(current.origin, endpoint, {})).status).toBe(401)
    }
  })
})

describe('sessions written before accounts existed', () => {
  it('keeps working and is stamped with the legacy account', async () => {
    // Discarding them instead would sign every paired desktop out on the very
    // upgrade that introduced accounts.
    const dataDir = tempDir()
    writeFileSync(
      join(dataDir, 'auth-sessions.json'),
      JSON.stringify({
        v: 1,
        sessions: [
          {
            accessHash: hashToken('access-legacy'),
            refreshHash: hashToken('refresh-legacy'),
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now()
          }
        ]
      })
    )
    current = await startTestRelay(() => ({
      ...PER_USER,
      dataDir
    }))

    const identity = await post(current.origin, 'capabilities', {}, 'access-legacy')
    expect(identity.status).toBe(200)
    expect(await identity.json()).toMatchObject({
      cloud: { userId: 'user-1' },
      capabilities: { flags: { 'relay.use': true } }
    })

    // The rewritten file carries the subject, so the adoption happens once
    // rather than on every start.
    await current.stop()
    current = null
    const snapshot = JSON.parse(readFileSync(join(dataDir, 'auth-sessions.json'), 'utf8')) as {
      v: number
      sessions: { accountId?: string }[]
    }
    expect(snapshot.v).toBe(2)
    expect(snapshot.sessions[0]?.accountId).toMatch(/^acct-/)
  })

  it('drops a record with no timestamp rather than sorting it as NaN', async () => {
    const dataDir = tempDir()
    writeFileSync(
      join(dataDir, 'auth-sessions.json'),
      JSON.stringify({
        v: 1,
        sessions: [
          {
            accessHash: hashToken('access-undated'),
            refreshHash: hashToken('refresh-undated'),
            expiresAt: Date.now() + 60_000
          }
        ]
      })
    )
    current = await startTestRelay(() => ({
      ...PER_USER,
      dataDir
    }))
    // Still usable — the missing timestamp only had to stop breaking the prune
    // order, not invalidate the session.
    expect((await post(current.origin, 'capabilities', {}, 'access-undated')).status).toBe(200)
  })
})

describe('taking over a machine the legacy account inherited', () => {
  /** What a relay that predates accounts has on disk: hosts with no owner. */
  function seedUnownedHost(dataDir: string, relayHostId: string): void {
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
            generation: 2,
            lastSeenAt: Date.now()
          }
        }
      })
    )
  }

  const PER_USER_WITH_SECRET = {
    ...PER_USER,
    enrollmentSecret: 'open-sesame',
    registrationMode: 'enrollment-secret' as const
  }

  it('hands it to the account that holds the enrolment secret', async () => {
    // Upgrading a relay adopts its hosts under the legacy account, so the
    // operator who then registers an account of their own finds their own
    // desktop refused. The enrolment secret — which is what granted that
    // identity before accounts existed — is what hands it over.
    const dataDir = tempDir()
    seedUnownedHost(dataDir, HOST_A)
    current = await startTestRelay(() => ({ ...PER_USER_WITH_SECRET, dataDir }))

    const ada = await registerAccount(current.origin, 'ada@example.com', {
      enrollmentSecret: 'open-sesame'
    })
    expect(
      (await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)).status
    ).toBe(403)
    expect(
      (
        await post(
          current.origin,
          'host-claim',
          { relayHostId: HOST_A, enrollmentSecret: 'open-sesame' },
          ada.accessToken
        )
      ).status
    ).toBe(200)
    expect(
      (await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)).status
    ).toBe(200)
  })

  it('refuses without the secret, and never moves a host off another account', async () => {
    current = await startTestRelay(() => PER_USER_WITH_SECRET)
    const ada = await registerAccount(current.origin, 'ada@example.com', {
      enrollmentSecret: 'open-sesame'
    })
    const bob = await registerAccount(current.origin, 'bob@example.com', {
      enrollmentSecret: 'open-sesame'
    })
    await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)

    expect(
      (
        await post(
          current.origin,
          'host-claim',
          { relayHostId: HOST_B, enrollmentSecret: 'wrong' },
          bob.accessToken
        )
      ).status
    ).toBe(401)
    // Right secret, but the host belongs to a real account rather than the
    // legacy one — the secret is not a master key over other people.
    const stolen = await post(
      current.origin,
      'host-claim',
      { relayHostId: HOST_A, enrollmentSecret: 'open-sesame' },
      bob.accessToken
    )
    expect(stolen.status).toBe(403)
    expect(await stolen.json()).toMatchObject({ error: 'host_owned_by_another_account' })
  })

  it('adopts a host whose owning account no longer exists', async () => {
    // If auth-accounts.json is lost, the legacy account is rebuilt with a fresh
    // id while every host record still names the old one. Without adoption they
    // are orphaned with no way back short of hand-editing cell-state.json.
    const dataDir = tempDir()
    seedUnownedHost(dataDir, HOST_A)
    current = await startTestRelay(() => ({ ...PER_USER_WITH_SECRET, dataDir }))
    await current.stop()

    rmSync(join(dataDir, 'auth-accounts.json'))
    current = await startTestRelay(() => ({ ...PER_USER_WITH_SECRET, dataDir }))
    const ada = await registerAccount(current.origin, 'ada@example.com', {
      enrollmentSecret: 'open-sesame'
    })
    expect(
      (await post(current.origin, 'relay-token', { relayHostId: HOST_A }, ada.accessToken)).status
    ).toBe(403)
    expect(
      (
        await post(
          current.origin,
          'host-claim',
          { relayHostId: HOST_A, enrollmentSecret: 'open-sesame' },
          ada.accessToken
        )
      ).status
    ).toBe(200)
  })
})

describe('session table fairness', () => {
  it('never lets one account evict another', async () => {
    // A global cap on a multi-account relay is a cross-account eviction
    // primitive: sign in until everyone else's oldest sessions fall off the
    // end, taking their refresh tokens with them.
    current = await startTestRelay(() => PER_USER)
    await registerAccount(current.origin, 'ada@example.com')
    const bob = await registerAccount(current.origin, 'bob@example.com')

    for (let attempt = 0; attempt < 70; attempt += 1) {
      const response = await post(current.origin, 'login', {
        email: 'ada@example.com',
        password: 'correct-horse'
      })
      expect(response.status).toBe(200)
    }

    expect((await post(current.origin, 'capabilities', {}, bob.accessToken)).status).toBe(200)
    expect((await post(current.origin, 'refresh', { refreshToken: bob.refreshToken })).status).toBe(
      200
    )
  })

  it('rotates the profile session rather than accumulating one per call', async () => {
    // Otherwise a repeatable endpoint is a way to fill the session table.
    current = await startTestRelay(() => PER_USER)
    const ada = await registerAccount(current.origin, 'ada@example.com')
    const rotated = (await (
      await post(current.origin, 'profile', {}, ada.accessToken)
    ).json()) as SessionBody
    expect(rotated.accessToken).not.toBe(ada.accessToken)
    expect((await post(current.origin, 'capabilities', {}, ada.accessToken)).status).toBe(401)
    expect((await post(current.origin, 'capabilities', {}, rotated.accessToken)).status).toBe(200)
  })
})

describe('the legacy identity', () => {
  it('refuses to start rather than silently rewrite it', async () => {
    // Every desktop paired under the stored triple signs it into its host
    // proof. An env_file that moved would otherwise turn the value into its
    // default and break every pairing with nothing in either log.
    const dataDir = tempDir()
    current = await startTestRelay(() => ({
      ...PER_USER,
      dataDir
    }))
    await current.stop()
    const config = { ...current.config, user: { ...current.config.user, userId: 'someone-else' } }
    current = null
    expect(() => createRelay(config, new Logger('error'))).toThrow(/does not match the environment/)
  })
})
