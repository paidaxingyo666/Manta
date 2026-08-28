import { app, ipcMain } from 'electron'
import type { Store } from '../persistence'
import { relaunchApp, type AppRelaunchReason } from '../app-relaunch'
import type {
  CreateLocalMantaProfileArgs,
  CreateLocalMantaProfileResult,
  CreateCloudLinkedMantaProfileArgs,
  CreateCloudLinkedMantaProfileResult,
  FindMantaProfileProjectsByPathArgs,
  FindMantaProfileProjectsByPathResult,
  MantaProfileListResult,
  RefreshCurrentMantaProfileAuthResult,
  SwitchMantaProfileArgs,
  SwitchMantaProfileResult,
  TransferMantaProfileProjectArgs,
  TransferMantaProfileProjectResult,
  ConnectCurrentMantaProfileResult,
  MantaProfileAuthStatus,
  SelectMantaProfileOrgArgs,
  SelectMantaProfileOrgResult,
  SignOutCurrentMantaProfileResult
} from '../../shared/manta-profiles'
import {
  createLocalMantaProfile,
  getMantaProfileListState,
  seedNewMantaProfileTelemetryConsent,
  setActiveMantaProfile
} from '../manta-profiles/profile-index-store'
import {
  cloudSessionIdentity,
  recordCloudSessionIdentityMutation
} from '../manta-profiles/profile-cloud-session-mutation'
import { getProfileUserDataPath } from '../manta-profiles/profile-storage-paths'
import { isMultiProfileUiEnabled } from '../manta-profiles/profile-ui-scope'
import { transferMantaProfileProject } from '../manta-profiles/profile-project-transfer'
import { findMantaProfileProjectsByPath } from '../manta-profiles/profile-project-presence'
import { flushActiveProfileBeforeFileMutation } from '../manta-profiles/profile-persistence-deadline'
import { normalizeExecutionHostId } from '../../shared/execution-host'
import {
  createCloudLinkedMantaProfile,
  connectCurrentMantaProfile,
  getCurrentMantaProfileAuthStatus,
  refreshCurrentMantaProfileAuth,
  selectCurrentMantaProfileOrg,
  signOutCurrentMantaProfile
} from '../manta-profiles/profile-cloud-service'
import { registerMantaProfileOrgMemberHandlers } from './manta-profile-org-members-handlers'

type RegisterMantaProfileHandlersOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
  onAuthMutation?: () => void
  onBeforeSignOut?: () => void
}

function profileIdFromArgs(args: unknown): string {
  if (
    !args ||
    typeof args !== 'object' ||
    typeof (args as SwitchMantaProfileArgs).profileId !== 'string'
  ) {
    throw new Error('invalid_manta_profile_id')
  }
  const profileId = (args as SwitchMantaProfileArgs).profileId.trim()
  if (!profileId) {
    throw new Error('invalid_manta_profile_id')
  }
  return profileId
}

function transferProjectArgsFromUnknown(args: unknown): TransferMantaProfileProjectArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_manta_profile_project_transfer')
  }
  const candidate = args as TransferMantaProfileProjectArgs
  const sourceProfileId = candidate.sourceProfileId?.trim()
  const targetProfileId = candidate.targetProfileId?.trim()
  const repoId = candidate.repoId?.trim()
  const mode = candidate.mode
  if (!sourceProfileId || !targetProfileId || !repoId || (mode !== 'move' && mode !== 'copy')) {
    throw new Error('invalid_manta_profile_project_transfer')
  }
  return {
    sourceProfileId,
    targetProfileId,
    repoId,
    mode
  }
}

function findProjectsByPathArgsFromUnknown(args: unknown): FindMantaProfileProjectsByPathArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_manta_profile_project_path')
  }
  const candidate = args as FindMantaProfileProjectsByPathArgs
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path) {
    throw new Error('invalid_manta_profile_project_path')
  }
  let executionHostId: FindMantaProfileProjectsByPathArgs['executionHostId'] = null
  if (candidate.executionHostId !== null && candidate.executionHostId !== undefined) {
    if (typeof candidate.executionHostId !== 'string') {
      throw new Error('invalid_manta_profile_project_path')
    }
    executionHostId = normalizeExecutionHostId(candidate.executionHostId)
    if (!executionHostId) {
      throw new Error('invalid_manta_profile_project_path')
    }
  }
  return {
    path,
    connectionId:
      typeof candidate.connectionId === 'string' ? candidate.connectionId.trim() || null : null,
    executionHostId,
    excludeProfileId:
      typeof candidate.excludeProfileId === 'string'
        ? candidate.excludeProfileId.trim() || null
        : null
  }
}

function orgIdFromUnknown(args: unknown): string {
  if (!args || typeof args !== 'object') {
    throw new Error('invalid_manta_profile_org_selection')
  }
  const orgId = (args as SelectMantaProfileOrgArgs).orgId?.trim()
  if (!orgId) {
    throw new Error('invalid_manta_profile_org_selection')
  }
  return orgId
}

function createCloudLinkedProfileArgsFromUnknown(args: unknown): CreateCloudLinkedMantaProfileArgs {
  if (!args || typeof args !== 'object') {
    return {}
  }
  const candidate = args as CreateCloudLinkedMantaProfileArgs
  const orgId = typeof candidate.orgId === 'string' ? candidate.orgId.trim() : undefined
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : undefined
  return {
    ...(orgId ? { orgId } : {}),
    ...(name ? { name } : {})
  }
}

async function runBeforeProfileRelaunch(
  onBeforeRelaunch?: () => void | Promise<void>
): Promise<void> {
  try {
    await onBeforeRelaunch?.()
  } catch (error) {
    console.warn(
      '[manta-profiles] Pre-relaunch cleanup failed; continuing profile switch:',
      error instanceof Error ? error.name : typeof error
    )
  }
}

function scheduleProfileRelaunch(reason: Extract<AppRelaunchReason, `profile-${string}`>): void {
  setTimeout(() => {
    relaunchApp(reason)
    // Why: app.quit() (not app.exit) so before-quit/will-quit still run —
    // renderer scrollback capture, PTY kill, stats flush, and daemon final
    // checkpoints must not be skipped on a profile switch.
    app.quit()
  }, 150)
}

export function registerMantaProfileHandlers(
  store: Store,
  options: RegisterMantaProfileHandlersOptions = {}
): void {
  ipcMain.handle(
    'mantaProfiles:list',
    (): MantaProfileListResult => ({
      ...getMantaProfileListState(),
      multiProfileUi: isMultiProfileUiEnabled()
    })
  )

  ipcMain.handle(
    'mantaProfiles:authStatus',
    (): MantaProfileAuthStatus => getCurrentMantaProfileAuthStatus(getProfileUserDataPath())
  )

  ipcMain.handle(
    'mantaProfiles:createLocal',
    (_event, args?: CreateLocalMantaProfileArgs): CreateLocalMantaProfileResult => {
      const result = createLocalMantaProfile(args)
      seedNewMantaProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
      return result
    }
  )

  ipcMain.handle(
    'mantaProfiles:switch',
    async (_event, args: SwitchMantaProfileArgs): Promise<SwitchMantaProfileResult> => {
      const profileId = profileIdFromArgs(args)
      const current = getMantaProfileListState()
      if (profileId === current.activeProfileId) {
        return { status: 'already-active' }
      }

      const activeProfile = current.profiles.find(
        (profile) => profile.id === current.activeProfileId
      )
      if (activeProfile?.cloud) {
        // Why: profile selection changes the expected identity synchronously;
        // stale refresh saves must fail even before relaunch teardown finishes.
        recordCloudSessionIdentityMutation(
          cloudSessionIdentity(activeProfile.id, activeProfile.cloud),
          getProfileUserDataPath()
        )
      }
      // Why: the current profile must be persisted before the global index
      // points startup at the target profile.
      await flushActiveProfileBeforeFileMutation(store)
      await runBeforeProfileRelaunch(options.onBeforeRelaunch)
      setActiveMantaProfile(profileId)

      scheduleProfileRelaunch('profile-switch')

      return { status: 'relaunching' }
    }
  )

  ipcMain.handle(
    'mantaProfiles:transferProject',
    async (
      _event,
      rawArgs: TransferMantaProfileProjectArgs
    ): Promise<TransferMantaProfileProjectResult> => {
      const args = transferProjectArgsFromUnknown(rawArgs)
      const current = getMantaProfileListState()
      if (args.targetProfileId === current.activeProfileId) {
        throw new Error('active_target_manta_profile_transfer_requires_relaunch')
      }
      if (args.mode === 'move' && args.sourceProfileId === current.activeProfileId) {
        // Why: transfer before any relaunch side effect so a duplicate-target
        // or validation failure cannot strand the app in a quitting state.
        await flushActiveProfileBeforeFileMutation(store)
        const result = transferMantaProfileProject(args, getProfileUserDataPath())
        if (result.status === 'transferred') {
          store.freezeWrites()
          await runBeforeProfileRelaunch(options.onBeforeRelaunch)
          setActiveMantaProfile(args.targetProfileId)
          scheduleProfileRelaunch('profile-transfer')
          return { ...result, willRelaunch: true }
        }
        return result
      }
      await flushActiveProfileBeforeFileMutation(store)
      return transferMantaProfileProject(args, getProfileUserDataPath())
    }
  )

  ipcMain.handle(
    'mantaProfiles:findProjectProfiles',
    (_event, rawArgs: FindMantaProfileProjectsByPathArgs): FindMantaProfileProjectsByPathResult =>
      findMantaProfileProjectsByPath(
        findProjectsByPathArgsFromUnknown(rawArgs),
        getProfileUserDataPath()
      )
  )

  ipcMain.handle(
    'mantaProfiles:connectCurrent',
    async (): Promise<ConnectCurrentMantaProfileResult> => {
      const result = await connectCurrentMantaProfile(getProfileUserDataPath())
      if (result.status === 'connected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'mantaProfiles:createCloudLinked',
    async (
      _event,
      rawArgs?: CreateCloudLinkedMantaProfileArgs
    ): Promise<CreateCloudLinkedMantaProfileResult> => {
      const result = await createCloudLinkedMantaProfile(
        getProfileUserDataPath(),
        createCloudLinkedProfileArgsFromUnknown(rawArgs)
      )
      if (result.status === 'created') {
        seedNewMantaProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
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

  registerMantaProfileOrgMemberHandlers()
}
