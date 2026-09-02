import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  ensureActive: vi.fn(),
  runWithFreshSession: vi.fn(),
  listHosts: vi.fn(),
  claimHost: vi.fn(),
  forgetHost: vi.fn(),
  describeHost: vi.fn()
}))

vi.mock('../../manta-profiles/profile-cloud-auth-config', () => ({
  getMantaCloudAuthConfig: mocks.getConfig
}))
vi.mock('../../manta-profiles/profile-index-store', () => ({
  ensureActiveMantaProfile: mocks.ensureActive
}))
vi.mock('../../manta-profiles/profile-cloud-session-refresh', () => ({
  runWithFreshMantaCloudSession: mocks.runWithFreshSession
}))
vi.mock('../../manta-profiles/profile-cloud-account-client', () => ({
  listMantaRelayHosts: mocks.listHosts,
  forgetMantaRelayHost: mocks.forgetHost,
  describeMantaRelayHost: mocks.describeHost,
  claimMantaRelayHost: mocks.claimHost
}))

import { MantaCloudRequestError } from '../../manta-profiles/profile-cloud-client'
import {
  forgetRelayHostForAccount,
  listRelayHostsForAccount,
  publishThisMachineToRelay,
  setRelayHostIdentityReader
} from './relay-host-directory'

const CONFIG = { configured: true, config: { hostsEndpoint: 'https://relay.example/hosts' } }

function signedIn(): void {
  mocks.getConfig.mockReturnValue(CONFIG)
  mocks.ensureActive.mockReturnValue({ profile: { id: 'local-1', cloud: { userId: 'user-1' } } })
  mocks.runWithFreshSession.mockImplementation(
    async (
      _config: unknown,
      _active: unknown,
      _path: unknown,
      operation: (s: unknown) => unknown
    ) => ({ status: 'ok', value: await operation({ accessToken: 'access-token' }) })
  )
}

describe('relay machine directory', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
    setRelayHostIdentityReader(() => 'aaaaaaaaaaaaaaaa')
  })

  it('marks the caller machine so the UI can refuse to forget it', async () => {
    signedIn()
    mocks.listHosts.mockResolvedValue([
      { relayHostId: 'aaaaaaaaaaaaaaaa', online: true },
      { relayHostId: 'bbbbbbbbbbbbbbbb', online: false }
    ])
    const result = await listRelayHostsForAccount('/tmp/user-data')
    expect(result).toEqual({
      status: 'ok',
      hosts: [
        { relayHostId: 'aaaaaaaaaaaaaaaa', online: true, isThisMachine: true },
        { relayHostId: 'bbbbbbbbbbbbbbbb', online: false, isThisMachine: false }
      ]
    })
  })

  it('reads a 404 as a relay without a directory, not as a failure', async () => {
    // The endpoint only exists on a relay that has accounts. Reporting it as an
    // error would put a red message in front of anyone who has not upgraded.
    signedIn()
    mocks.listHosts.mockRejectedValue(new MantaCloudRequestError(404))
    expect(await listRelayHostsForAccount('/tmp/user-data')).toEqual({ status: 'unsupported' })
  })

  it('reports an unconfigured relay and a signed-out profile apart', async () => {
    mocks.getConfig.mockReturnValue({ configured: false, setupMessage: 'no relay' })
    expect(await listRelayHostsForAccount('/tmp/user-data')).toEqual({ status: 'unconfigured' })

    mocks.getConfig.mockReturnValue(CONFIG)
    mocks.ensureActive.mockReturnValue({ profile: { id: 'local-1' } })
    expect(await listRelayHostsForAccount('/tmp/user-data')).toEqual({ status: 'signed-out' })
  })

  it('returns the refreshed list after forgetting a machine', async () => {
    signedIn()
    mocks.forgetHost.mockResolvedValue(undefined)
    mocks.listHosts.mockResolvedValue([{ relayHostId: 'aaaaaaaaaaaaaaaa', online: true }])
    const result = await forgetRelayHostForAccount('/tmp/user-data', 'bbbbbbbbbbbbbbbb')
    expect(mocks.forgetHost).toHaveBeenCalledWith(CONFIG.config, 'access-token', 'bbbbbbbbbbbbbbbb')
    expect(result).toEqual({
      status: 'ok',
      hosts: [{ relayHostId: 'aaaaaaaaaaaaaaaa', online: true, isThisMachine: true }]
    })
  })

  it('takes the machine over from the legacy account before giving up', async () => {
    // A relay upgraded from before accounts owns every host under the identity
    // from its environment, so an operator who registers an account of their
    // own would sign in and then find the relay path dead with a 403 nobody
    // sees. The enrolment secret is what hands it over.
    signedIn()
    mocks.getConfig.mockReturnValue({
      configured: true,
      config: { ...CONFIG.config, enrollmentSecret: 'open-sesame' }
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'host_owned_by_another_account' })
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: null, json: async () => ({}) })
    mocks.claimHost.mockResolvedValue(undefined)
    mocks.describeHost.mockResolvedValue(undefined)

    expect(await publishThisMachineToRelay('/tmp/user-data', '1.0.0')).toBe('published')
    expect(mocks.claimHost).toHaveBeenCalledWith(
      expect.anything(),
      'access-token',
      'aaaaaaaaaaaaaaaa'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('says signed-out when the session cannot be refreshed', async () => {
    signedIn()
    mocks.runWithFreshSession.mockResolvedValue({ status: 'reconnect-required' })
    expect(await listRelayHostsForAccount('/tmp/user-data')).toEqual({ status: 'signed-out' })
  })
})
