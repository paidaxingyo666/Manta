import { ipcMain } from 'electron'
import type {
  MantaOrgRole,
  MantaProfileOrgInviteRevokeArgs,
  MantaProfileOrgMemberChangeRoleArgs,
  MantaProfileOrgMemberInviteArgs,
  MantaProfileOrgMemberMutationResult,
  MantaProfileOrgMemberRemoveArgs,
  MantaProfileOrgMembersListArgs,
  MantaProfileOrgMembersListResult
} from '../../shared/manta-profiles'
import { getProfileUserDataPath } from '../manta-profiles/profile-storage-paths'
import {
  changeMantaProfileOrgMemberRole,
  inviteMantaProfileOrgMember,
  listMantaProfileOrgMembers,
  removeMantaProfileOrgMember,
  revokeMantaProfileOrgInvite
} from '../manta-profiles/profile-cloud-org-members-service'

function orgMembersScopedArgs(args: unknown): { orgId: string; record: Record<string, unknown> } {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_manta_profile_org_selection')
  }
  const record = args as Record<string, unknown>
  const orgId = typeof record.orgId === 'string' ? record.orgId.trim() : ''
  if (!orgId) {
    throw new Error('invalid_manta_profile_org_selection')
  }
  return { orgId, record }
}

function orgRoleFromUnknown(value: unknown): MantaOrgRole {
  if (value === 'owner' || value === 'admin' || value === 'member') {
    return value
  }
  throw new Error('invalid_manta_org_role')
}

function orgEmailFromUnknown(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : ''
  if (!email) {
    throw new Error('invalid_manta_org_member_email')
  }
  return email
}

function orgUserIdFromUnknown(value: unknown): string {
  const userId = typeof value === 'string' ? value.trim() : ''
  if (!userId) {
    throw new Error('invalid_manta_org_member_user')
  }
  return userId
}

function orgMemberInviteArgsFromUnknown(args: unknown): MantaProfileOrgMemberInviteArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email), role: orgRoleFromUnknown(record.role) }
}

function orgInviteRevokeArgsFromUnknown(args: unknown): MantaProfileOrgInviteRevokeArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, email: orgEmailFromUnknown(record.email) }
}

function orgMemberChangeRoleArgsFromUnknown(args: unknown): MantaProfileOrgMemberChangeRoleArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return {
    orgId,
    userId: orgUserIdFromUnknown(record.userId),
    role: orgRoleFromUnknown(record.role)
  }
}

function orgMemberRemoveArgsFromUnknown(args: unknown): MantaProfileOrgMemberRemoveArgs {
  const { orgId, record } = orgMembersScopedArgs(args)
  return { orgId, userId: orgUserIdFromUnknown(record.userId) }
}

export function registerMantaProfileOrgMemberHandlers(): void {
  ipcMain.handle(
    'mantaProfiles:orgMembersList',
    async (
      _event,
      rawArgs: MantaProfileOrgMembersListArgs
    ): Promise<MantaProfileOrgMembersListResult> =>
      listMantaProfileOrgMembers(getProfileUserDataPath(), orgMembersScopedArgs(rawArgs).orgId)
  )

  ipcMain.handle(
    'mantaProfiles:orgMemberInvite',
    async (
      _event,
      rawArgs: MantaProfileOrgMemberInviteArgs
    ): Promise<MantaProfileOrgMemberMutationResult> =>
      inviteMantaProfileOrgMember(getProfileUserDataPath(), orgMemberInviteArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'mantaProfiles:orgInviteRevoke',
    async (
      _event,
      rawArgs: MantaProfileOrgInviteRevokeArgs
    ): Promise<MantaProfileOrgMemberMutationResult> =>
      revokeMantaProfileOrgInvite(getProfileUserDataPath(), orgInviteRevokeArgsFromUnknown(rawArgs))
  )

  ipcMain.handle(
    'mantaProfiles:orgMemberChangeRole',
    async (
      _event,
      rawArgs: MantaProfileOrgMemberChangeRoleArgs
    ): Promise<MantaProfileOrgMemberMutationResult> =>
      changeMantaProfileOrgMemberRole(
        getProfileUserDataPath(),
        orgMemberChangeRoleArgsFromUnknown(rawArgs)
      )
  )

  ipcMain.handle(
    'mantaProfiles:orgMemberRemove',
    async (
      _event,
      rawArgs: MantaProfileOrgMemberRemoveArgs
    ): Promise<MantaProfileOrgMemberMutationResult> =>
      removeMantaProfileOrgMember(getProfileUserDataPath(), orgMemberRemoveArgsFromUnknown(rawArgs))
  )
}
