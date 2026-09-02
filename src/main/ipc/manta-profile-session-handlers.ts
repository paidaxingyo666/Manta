import { ipcMain } from 'electron'
import type { ConnectCurrentMantaProfileArgs } from '../../shared/manta-cloud-credentials'
import type {
  ConnectCurrentMantaProfileResult,
  RefreshCurrentMantaProfileAuthResult,
  SelectMantaProfileOrgArgs,
  SelectMantaProfileOrgResult,
  SignOutCurrentMantaProfileResult
} from '../../shared/manta-profiles'
import {
  connectCurrentMantaProfile,
  refreshCurrentMantaProfileAuth,
  selectCurrentMantaProfileOrg,
  signOutCurrentMantaProfile
} from '../manta-profiles/profile-cloud-service'
import { getProfileUserDataPath } from '../manta-profiles/profile-storage-paths'
import { connectArgsFromUnknown } from './manta-profile-connect-args'

export type MantaProfileSessionHandlerOptions = {
  onAuthMutation?: () => void
  onBeforeSignOut?: () => void
}

/** Throws rather than defaulting: an empty selection must not silently mean "any org". */
function orgIdFromUnknown(args: unknown): string {
  const value = (args as SelectMantaProfileOrgArgs | undefined)?.orgId
  const orgId = typeof value === 'string' ? value.trim() : ''
  if (!orgId) {
    throw new Error('invalid_manta_profile_org_selection')
  }
  return orgId
}

/** Sign in, refresh, sign out, and organization selection for the active profile. */
export function registerMantaProfileSessionHandlers(
  options: MantaProfileSessionHandlerOptions
): void {
  ipcMain.handle(
    'mantaProfiles:connectCurrent',
    async (
      _event,
      rawArgs?: ConnectCurrentMantaProfileArgs
    ): Promise<ConnectCurrentMantaProfileResult> => {
      const result = await connectCurrentMantaProfile(
        getProfileUserDataPath(),
        connectArgsFromUnknown(rawArgs)
      )
      if (result.status === 'connected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'mantaProfiles:refreshAuth',
    async (): Promise<RefreshCurrentMantaProfileAuthResult> => {
      const result = await refreshCurrentMantaProfileAuth(getProfileUserDataPath())
      if (result.status === 'refreshed') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'mantaProfiles:signOutCurrent',
    async (): Promise<SignOutCurrentMantaProfileResult> => {
      options.onBeforeSignOut?.()
      return signOutCurrentMantaProfile(getProfileUserDataPath())
    }
  )

  ipcMain.handle(
    'mantaProfiles:selectOrg',
    async (_event, rawArgs: SelectMantaProfileOrgArgs): Promise<SelectMantaProfileOrgResult> => {
      const result = await selectCurrentMantaProfileOrg(
        getProfileUserDataPath(),
        orgIdFromUnknown(rawArgs)
      )
      if (result.status === 'selected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )
}
