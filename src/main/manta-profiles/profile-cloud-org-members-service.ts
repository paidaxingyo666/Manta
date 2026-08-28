import type {
  MantaProfileOrgInviteRevokeArgs,
  MantaProfileOrgMemberChangeRoleArgs,
  MantaProfileOrgMemberInviteArgs,
  MantaProfileOrgMemberMutationResult,
  MantaProfileOrgMemberRemoveArgs,
  MantaProfileOrgMembersListResult
} from '../../shared/manta-profiles'
import type { ActiveMantaProfileState } from './profile-index-store'
import { ensureActiveMantaProfile } from './profile-index-store'
import type { MantaCloudAuthConfig } from './profile-cloud-auth-config'
import { getMantaCloudAuthConfig, isMantaCloudDevAuthEnabled } from './profile-cloud-auth-config'
import type { MantaCloudSession } from './profile-cloud-session-store'
import { MantaCloudRequestError } from './profile-cloud-client'
import { runWithFreshMantaCloudSession } from './profile-cloud-session-refresh'
import {
  changeMantaCloudOrgMemberRole,
  inviteMantaCloudOrgMember,
  listMantaCloudOrgMembers,
  removeMantaCloudOrgMember,
  revokeMantaCloudOrgInvite
} from './profile-cloud-org-members-client'
import {
  changeDevMantaCloudOrgMemberRole,
  inviteDevMantaCloudOrgMember,
  listDevMantaCloudOrgMembers,
  removeDevMantaCloudOrgMember,
  revokeDevMantaCloudOrgInvite
} from './profile-cloud-dev-org-members'

type OrgCallResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'reconnect-required' }
  | { status: 'request-error'; error: MantaCloudRequestError }
  | { status: 'failed'; error: string }

// Why: only a 401 means the token itself is stale and should drive a session
// refresh/reconnect. 403/404/409/400 are business or permission outcomes the UI
// must interpret, so they are surfaced as values rather than thrown — otherwise
// runWithFreshMantaCloudSession would treat a 403 as an auth failure and burn a
// pointless token refresh + retry before giving up.
async function runOrgMemberCall<T>(
  config: MantaCloudAuthConfig,
  active: ActiveMantaProfileState,
  userDataPath: string,
  call: (session: MantaCloudSession) => Promise<T>
): Promise<OrgCallResult<T>> {
  try {
    const operation = await runWithFreshMantaCloudSession(
      config,
      active,
      userDataPath,
      async (session) => {
        try {
          return { ok: true as const, value: await call(session) }
        } catch (error) {
          if (error instanceof MantaCloudRequestError && error.statusCode !== 401) {
            return { ok: false as const, error }
          }
          throw error
        }
      }
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required' }
    }
    const outcome = operation.value
    return outcome.ok
      ? { status: 'ok', value: outcome.value }
      : { status: 'request-error', error: outcome.error }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

function mapMutationRequestError(error: MantaCloudRequestError): MantaProfileOrgMemberMutationResult {
  switch (error.statusCode) {
    case 403:
      return { status: 'forbidden' }
    case 404:
      return { status: 'not-found' }
    case 409:
      return {
        status: 'conflict',
        reason: error.errorCode === 'already_member' ? 'already_member' : 'already_invited'
      }
    case 400:
      return {
        status: 'invalid',
        reason:
          error.errorCode === 'cannot_remove_self' ? 'cannot_remove_self' : 'cannot_change_own_role'
      }
    default:
      return { status: 'failed', error: error.message }
  }
}

function mapMutationResult(result: OrgCallResult<void>): MantaProfileOrgMemberMutationResult {
  switch (result.status) {
    case 'ok':
      return { status: 'ok' }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return mapMutationRequestError(result.error)
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function listMantaProfileOrgMembers(
  userDataPath: string,
  orgId: string
): Promise<MantaProfileOrgMembersListResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  if (isMantaCloudDevAuthEnabled()) {
    return { status: 'ok', roster: listDevMantaCloudOrgMembers(orgId) }
  }
  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  const result = await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
    listMantaCloudOrgMembers(configState.config, session, orgId)
  )
  switch (result.status) {
    case 'ok':
      return { status: 'ok', roster: result.value }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return { status: 'failed', error: result.error.message }
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function inviteMantaProfileOrgMember(
  userDataPath: string,
  args: MantaProfileOrgMemberInviteArgs
): Promise<MantaProfileOrgMemberMutationResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  if (isMantaCloudDevAuthEnabled()) {
    return inviteDevMantaCloudOrgMember(args)
  }
  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      inviteMantaCloudOrgMember(configState.config, session, args)
    )
  )
}

export async function revokeMantaProfileOrgInvite(
  userDataPath: string,
  args: MantaProfileOrgInviteRevokeArgs
): Promise<MantaProfileOrgMemberMutationResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  if (isMantaCloudDevAuthEnabled()) {
    return revokeDevMantaCloudOrgInvite(args)
  }
  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      revokeMantaCloudOrgInvite(configState.config, session, args)
    )
  )
}

export async function changeMantaProfileOrgMemberRole(
  userDataPath: string,
  args: MantaProfileOrgMemberChangeRoleArgs
): Promise<MantaProfileOrgMemberMutationResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  if (isMantaCloudDevAuthEnabled()) {
    return changeDevMantaCloudOrgMemberRole(args)
  }
  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      changeMantaCloudOrgMemberRole(configState.config, session, args)
    )
  )
}

export async function removeMantaProfileOrgMember(
  userDataPath: string,
  args: MantaProfileOrgMemberRemoveArgs
): Promise<MantaProfileOrgMemberMutationResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  if (isMantaCloudDevAuthEnabled()) {
    return removeDevMantaCloudOrgMember(args)
  }
  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      removeMantaCloudOrgMember(configState.config, session, args)
    )
  )
}
