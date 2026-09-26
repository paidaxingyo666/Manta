import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import {
  ORCA_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  type MantaProfileListResult,
  type SwitchMantaProfileResult,
  type TransferMantaProfileProjectResult
} from '../../shared/manta-profiles'
import { prepareAndInvokeAppRestart } from '../renderer-restart-wiring'
import { awaitBeforeUnloadCheckpoint } from '../preload-runtime-support'

export const mantaProfilesApi = {
  list: () => ipcRenderer.invoke('mantaProfiles:list'),
  authStatus: () => ipcRenderer.invoke('mantaProfiles:authStatus'),
  onAuthStatusChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(ORCA_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(ORCA_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
  },
  createLocal: (args) => ipcRenderer.invoke('mantaProfiles:createLocal', args),
  createCloudLinked: (args) => ipcRenderer.invoke('mantaProfiles:createCloudLinked', args),
  switchProfile: (args) =>
    prepareAndInvokeAppRestart(
      window,
      (): Promise<SwitchMantaProfileResult> => ipcRenderer.invoke('mantaProfiles:switch', args),
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'relaunching'
    ),
  transferProject: async (args) => {
    const invoke = (): Promise<TransferMantaProfileProjectResult> =>
      ipcRenderer.invoke('mantaProfiles:transferProject', args)
    if (args.mode !== 'move') {
      return invoke()
    }
    const current: MantaProfileListResult = await ipcRenderer.invoke('mantaProfiles:list')
    if (args.sourceProfileId !== current.activeProfileId) {
      return invoke()
    }
    return prepareAndInvokeAppRestart(
      window,
      invoke,
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'transferred' && result.willRelaunch === true
    )
  },
  findProjectProfiles: (args) => ipcRenderer.invoke('mantaProfiles:findProjectProfiles', args),
  connectCurrent: () => ipcRenderer.invoke('mantaProfiles:connectCurrent'),
  refreshAuth: () => ipcRenderer.invoke('mantaProfiles:refreshAuth'),
  signOutCurrent: () => ipcRenderer.invoke('mantaProfiles:signOutCurrent'),
  selectOrg: (args) => ipcRenderer.invoke('mantaProfiles:selectOrg', args),
  orgMembersList: (args) => ipcRenderer.invoke('mantaProfiles:orgMembersList', args),
  orgMemberInvite: (args) => ipcRenderer.invoke('mantaProfiles:orgMemberInvite', args),
  orgInviteRevoke: (args) => ipcRenderer.invoke('mantaProfiles:orgInviteRevoke', args),
  orgMemberChangeRole: (args) => ipcRenderer.invoke('mantaProfiles:orgMemberChangeRole', args),
  orgMemberRemove: (args) => ipcRenderer.invoke('mantaProfiles:orgMemberRemove', args)
} satisfies PreloadApi['mantaProfiles']
