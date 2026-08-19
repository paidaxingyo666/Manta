import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  listMantaProfileOrgMembersMock,
  inviteMantaProfileOrgMemberMock,
  revokeMantaProfileOrgInviteMock,
  changeMantaProfileOrgMemberRoleMock,
  removeMantaProfileOrgMemberMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  listMantaProfileOrgMembersMock: vi.fn(),
  inviteMantaProfileOrgMemberMock: vi.fn(),
  revokeMantaProfileOrgInviteMock: vi.fn(),
  changeMantaProfileOrgMemberRoleMock: vi.fn(),
  removeMantaProfileOrgMemberMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../manta-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => '/tmp/manta-user-data'
}))

vi.mock('../manta-profiles/profile-cloud-org-members-service', () => ({
  listMantaProfileOrgMembers: listMantaProfileOrgMembersMock,
  inviteMantaProfileOrgMember: inviteMantaProfileOrgMemberMock,
  revokeMantaProfileOrgInvite: revokeMantaProfileOrgInviteMock,
  changeMantaProfileOrgMemberRole: changeMantaProfileOrgMemberRoleMock,
  removeMantaProfileOrgMember: removeMantaProfileOrgMemberMock
}))

import { registerMantaProfileOrgMemberHandlers } from './manta-profile-org-members-handlers'

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler for ${channel}`)
  }
  return handler({}, args)
}

describe('registerMantaProfileOrgMemberHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    listMantaProfileOrgMembersMock.mockReset().mockResolvedValue({ status: 'ok', roster: {} })
    inviteMantaProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    revokeMantaProfileOrgInviteMock.mockReset().mockResolvedValue({ status: 'ok' })
    changeMantaProfileOrgMemberRoleMock.mockReset().mockResolvedValue({ status: 'ok' })
    removeMantaProfileOrgMemberMock.mockReset().mockResolvedValue({ status: 'ok' })
    registerMantaProfileOrgMemberHandlers()
  })

  it('registers all five org-member channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'mantaProfiles:orgInviteRevoke',
        'mantaProfiles:orgMemberChangeRole',
        'mantaProfiles:orgMemberInvite',
        'mantaProfiles:orgMemberRemove',
        'mantaProfiles:orgMembersList'
      ].sort()
    )
  })

  it('forwards a valid invite to the service with a trimmed email', async () => {
    await invoke('mantaProfiles:orgMemberInvite', {
      orgId: 'org-1',
      email: '  new@example.com  ',
      role: 'admin'
    })
    expect(inviteMantaProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/manta-user-data', {
      orgId: 'org-1',
      email: 'new@example.com',
      role: 'admin'
    })
  })

  it('rejects an invite with a missing org id', async () => {
    await expect(
      invoke('mantaProfiles:orgMemberInvite', { email: 'a@b.com', role: 'member' })
    ).rejects.toThrow('invalid_manta_profile_org_selection')
    expect(inviteMantaProfileOrgMemberMock).not.toHaveBeenCalled()
  })

  it('rejects an invite with an unknown role', async () => {
    await expect(
      invoke('mantaProfiles:orgMemberInvite', { orgId: 'org-1', email: 'a@b.com', role: 'root' })
    ).rejects.toThrow('invalid_manta_org_role')
  })

  it('rejects a role change with a blank user id', async () => {
    await expect(
      invoke('mantaProfiles:orgMemberChangeRole', { orgId: 'org-1', userId: '  ', role: 'admin' })
    ).rejects.toThrow('invalid_manta_org_member_user')
  })

  it('forwards remove and revoke with validated args', async () => {
    await invoke('mantaProfiles:orgMemberRemove', { orgId: 'org-1', userId: 'user-2' })
    expect(removeMantaProfileOrgMemberMock).toHaveBeenCalledWith('/tmp/manta-user-data', {
      orgId: 'org-1',
      userId: 'user-2'
    })
    await invoke('mantaProfiles:orgInviteRevoke', { orgId: 'org-1', email: 'gone@b.com' })
    expect(revokeMantaProfileOrgInviteMock).toHaveBeenCalledWith('/tmp/manta-user-data', {
      orgId: 'org-1',
      email: 'gone@b.com'
    })
  })
})
