import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const mantaProfilesApi = {
  list: () => ipcRenderer.invoke('mantaProfiles:list'),
  authStatus: () => ipcRenderer.invoke('mantaProfiles:authStatus'),
  createLocal: (args) => ipcRenderer.invoke('mantaProfiles:createLocal', args),
  createCloudLinked: (args) => ipcRenderer.invoke('mantaProfiles:createCloudLinked', args),
  switchProfile: (args) => ipcRenderer.invoke('mantaProfiles:switch', args),
  transferProject: (args) => ipcRenderer.invoke('mantaProfiles:transferProject', args),
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
