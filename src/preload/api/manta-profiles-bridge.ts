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
  connectCurrent: (args) => ipcRenderer.invoke('mantaProfiles:connectCurrent', args),
  relaySignInMethods: () => ipcRenderer.invoke('mantaRelay:signInMethods'),
  listRelayHosts: () => ipcRenderer.invoke('mantaRelay:listHosts'),
  forgetRelayHost: (args) => ipcRenderer.invoke('mantaRelay:forgetHost', args),
  refreshAuth: () => ipcRenderer.invoke('mantaProfiles:refreshAuth'),
  signOutCurrent: () => ipcRenderer.invoke('mantaProfiles:signOutCurrent'),
  applyCloudEndpoints: (overrides) =>
    ipcRenderer.invoke('mantaProfiles:applyCloudEndpoints', overrides),
  selectOrg: (args) => ipcRenderer.invoke('mantaProfiles:selectOrg', args),
  orgMembersList: (args) => ipcRenderer.invoke('mantaProfiles:orgMembersList', args),
  orgMemberInvite: (args) => ipcRenderer.invoke('mantaProfiles:orgMemberInvite', args),
  orgInviteRevoke: (args) => ipcRenderer.invoke('mantaProfiles:orgInviteRevoke', args),
  orgMemberChangeRole: (args) => ipcRenderer.invoke('mantaProfiles:orgMemberChangeRole', args),
  orgMemberRemove: (args) => ipcRenderer.invoke('mantaProfiles:orgMemberRemove', args)
} satisfies PreloadApi['mantaProfiles']
