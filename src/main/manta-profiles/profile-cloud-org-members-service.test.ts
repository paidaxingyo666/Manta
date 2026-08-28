import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MantaOrgMembersRoster } from '../../shared/manta-profiles'
import { MantaCloudRequestError } from './profile-cloud-client'

const {
  runWithFreshMantaCloudSessionMock,
  listMantaCloudOrgMembersMock,
  inviteMantaCloudOrgMemberMock,
  revokeMantaCloudOrgInviteMock,
  changeMantaCloudOrgMemberRoleMock,
  removeMantaCloudOrgMemberMock
} = vi.hoisted(() => ({
  runWithFreshMantaCloudSessionMock: vi.fn(),
  listMantaCloudOrgMembersMock: vi.fn(),
  inviteMantaCloudOrgMemberMock: vi.fn(),
  revokeMantaCloudOrgInviteMock: vi.fn(),
  changeMantaCloudOrgMemberRoleMock: vi.fn(),
  removeMantaCloudOrgMemberMock: vi.fn()
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataPath }
}))

vi.mock('./profile-cloud-session-refresh', () => ({
  runWithFreshMantaCloudSessionMock,
  runWithFreshMantaCloudSession: runWithFreshMantaCloudSessionMock
}))

vi.mock('./profile-cloud-org-members-client', () => ({
  listMantaCloudOrgMembers: listMantaCloudOrgMembersMock,
  inviteMantaCloudOrgMember: inviteMantaCloudOrgMemberMock,
  revokeMantaCloudOrgInvite: revokeMantaCloudOrgInviteMock,
  changeMantaCloudOrgMemberRole: changeMantaCloudOrgMemberRoleMock,
  removeMantaCloudOrgMember: removeMantaCloudOrgMemberMock
}))

import {
  changeMantaProfileOrgMemberRole,
  inviteMantaProfileOrgMember,
  listMantaProfileOrgMembers,
  removeMantaProfileOrgMember,
  revokeMantaProfileOrgInvite
} from './profile-cloud-org-members-service'

const fakeSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 3_600_000,
  capabilities: { flags: {}, refreshedAt: 1 }
}

// Why: mirror the real contract — invoke the operation with a live session and
// surface its resolved value; business 4xx are returned by the operation as
// values, never thrown, so the session layer never sees them.
function runOperationDirectly(): void {
  runWithFreshMantaCloudSessionMock.mockImplementation(
    async (
      _config: unknown,
      _active: unknown,
      _path: unknown,
      op: (session: unknown) => unknown
    ) => ({
      status: 'ok',
      value: await op(fakeSession)
    })
  )
}

function configureCloudEnv(): void {
  vi.stubEnv('MANTA_CLOUD_API_URL', 'https://manta-cloud.example')
  vi.stubEnv('MANTA_CLOUD_CLIENT_ID', 'desktop-client')
}

const roster: MantaOrgMembersRoster = {
  members: [{ userId: 'user-1', email: 'nina@example.com', role: 'owner' }],
  pendingInvites: [],
  viewerRole: 'owner',
  canManageMembers: true
}

describe('Manta cloud org members service (configured)', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'manta-org-members-'))
    runWithFreshMantaCloudSessionMock.mockReset()
    listMantaCloudOrgMembersMock.mockReset()
    inviteMantaCloudOrgMemberMock.mockReset()
    revokeMantaCloudOrgInviteMock.mockReset()
    changeMantaCloudOrgMemberRoleMock.mockReset()
    removeMantaCloudOrgMemberMock.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('MANTA_CLOUD_DEV_AUTH', '')
    vi.stubEnv('MANTA_CLOUD_API_URL', '')
    vi.stubEnv('MANTA_CLOUD_CLIENT_ID', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('reports unconfigured when cloud sign-in is not set up', async () => {
    await expect(listMantaProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'unconfigured'
    })
    expect(runWithFreshMantaCloudSessionMock).not.toHaveBeenCalled()
  })

  it('returns the roster from the client', async () => {
    configureCloudEnv()
    runOperationDirectly()
    listMantaCloudOrgMembersMock.mockResolvedValue(roster)

    await expect(listMantaProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'ok',
      roster
    })
    expect(listMantaCloudOrgMembersMock).toHaveBeenCalledWith(
      expect.any(Object),
      fakeSession,
      'org-1'
    )
  })

  it('maps a 409 already_member invite conflict', async () => {
    configureCloudEnv()
    runOperationDirectly()
    inviteMantaCloudOrgMemberMock.mockRejectedValue(new MantaCloudRequestError(409, 'already_member'))

    await expect(
      inviteMantaProfileOrgMember(userDataPath, { orgId: 'org-1', email: 'a@b.com', role: 'member' })
    ).resolves.toEqual({ status: 'conflict', reason: 'already_member' })
  })

  it('maps a 403 role change to forbidden', async () => {
    configureCloudEnv()
    runOperationDirectly()
    changeMantaCloudOrgMemberRoleMock.mockRejectedValue(new MantaCloudRequestError(403))

    await expect(
      changeMantaProfileOrgMemberRole(userDataPath, {
        orgId: 'org-1',
        userId: 'user-2',
        role: 'admin'
      })
    ).resolves.toEqual({ status: 'forbidden' })
  })

  it('maps a 400 cannot_remove_self to an invalid result', async () => {
    configureCloudEnv()
    runOperationDirectly()
    removeMantaCloudOrgMemberMock.mockRejectedValue(
      new MantaCloudRequestError(400, 'cannot_remove_self')
    )

    await expect(
      removeMantaProfileOrgMember(userDataPath, { orgId: 'org-1', userId: 'user-1' })
    ).resolves.toEqual({ status: 'invalid', reason: 'cannot_remove_self' })
  })

  it('maps a 404 revoke to not-found', async () => {
    configureCloudEnv()
    runOperationDirectly()
    revokeMantaCloudOrgInviteMock.mockRejectedValue(new MantaCloudRequestError(404))

    await expect(
      revokeMantaProfileOrgInvite(userDataPath, { orgId: 'org-1', email: 'gone@b.com' })
    ).resolves.toEqual({ status: 'not-found' })
  })

  it('reports reconnect-required when the session layer cannot refresh', async () => {
    configureCloudEnv()
    runWithFreshMantaCloudSessionMock.mockResolvedValue({ status: 'reconnect-required' })

    await expect(listMantaProfileOrgMembers(userDataPath, 'org-1')).resolves.toEqual({
      status: 'reconnect-required'
    })
  })
})

describe('Manta cloud org members service (dev auth)', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'manta-org-members-dev-'))
    runWithFreshMantaCloudSessionMock.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('MANTA_CLOUD_DEV_AUTH', '1')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('serves an in-memory roster the caller can manage', async () => {
    const result = await listMantaProfileOrgMembers(userDataPath, 'dev-list-org')
    if (result.status !== 'ok') {
      throw new Error(`Expected ok, got ${result.status}`)
    }
    expect(result.roster.canManageMembers).toBe(true)
    expect(result.roster.viewerRole).toBe('owner')
    expect(result.roster.members[0]).toMatchObject({ role: 'owner' })
    expect(result.roster.members.some((member) => member.userId === null)).toBe(true)
    expect(result.roster.pendingInvites.length).toBeGreaterThan(0)
    expect(runWithFreshMantaCloudSessionMock).not.toHaveBeenCalled()
  })

  it('mutates the dev roster across invite and revoke', async () => {
    const orgId = 'dev-mutate-org'
    await expect(
      inviteMantaProfileOrgMember(userDataPath, {
        orgId,
        email: 'fresh@manta.local',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'ok' })

    const afterInvite = await listMantaProfileOrgMembers(userDataPath, orgId)
    if (afterInvite.status !== 'ok') {
      throw new Error('expected ok')
    }
    expect(afterInvite.roster.pendingInvites.some((i) => i.email === 'fresh@manta.local')).toBe(true)

    await expect(
      inviteMantaProfileOrgMember(userDataPath, {
        orgId,
        email: 'fresh@manta.local',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'conflict', reason: 'already_invited' })

    await expect(
      revokeMantaProfileOrgInvite(userDataPath, { orgId, email: 'fresh@manta.local' })
    ).resolves.toEqual({ status: 'ok' })
    await expect(
      revokeMantaProfileOrgInvite(userDataPath, { orgId, email: 'fresh@manta.local' })
    ).resolves.toEqual({ status: 'not-found' })
  })

  it('blocks changing the dev owner (self) role', async () => {
    const orgId = 'dev-self-org'
    const list = await listMantaProfileOrgMembers(userDataPath, orgId)
    if (list.status !== 'ok') {
      throw new Error('expected ok')
    }
    const self = list.roster.members.find((member) => member.role === 'owner')
    await expect(
      changeMantaProfileOrgMemberRole(userDataPath, {
        orgId,
        userId: self?.userId ?? 'dev-user',
        role: 'member'
      })
    ).resolves.toEqual({ status: 'invalid', reason: 'cannot_change_own_role' })
  })
})
