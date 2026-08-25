import type { PreloadApi } from '../../../../preload/api-types'
import {
  DEFAULT_LOCAL_MANTA_PROFILE_ID,
  createDefaultLocalMantaProfile
} from '../../../../shared/manta-profiles'

export function createWebMantaProfilesApi(): Partial<PreloadApi> {
  const webMantaProfileAuthStatus = () =>
    Promise.resolve({
      activeProfileId: DEFAULT_LOCAL_MANTA_PROFILE_ID,
      configured: false,
      state: 'unconfigured' as const,
      persistence: 'none' as const,
      setupMessage: 'Manta Cloud sign-in is not available in the browser fallback.'
    })
  return {
    mantaProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_MANTA_PROFILE_ID,
          profiles: [createDefaultLocalMantaProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webMantaProfileAuthStatus,
      // Fork-owned: the browser fallback has no host key, so nothing here can
      // sign a per-account identity. Reporting 'shared' keeps the sign-in UI
      // consistent with a relay deployed in either mode.
      relaySignInMethods: async () => ({
        accounts: 'shared' as const,
        enrollmentSecretRequired: true
      }),
      // The relay directory is desktop-only: a browser client has no host key,
      // so it is never a machine on anyone's list.
      listRelayHosts: async () => ({ status: 'unconfigured' as const }),
      forgetRelayHost: async () => ({ status: 'unconfigured' as const }),
      applyCloudEndpoints: async () => {
        // Why: the web client cannot restart the desktop app; endpoints are a
        // desktop-only setting.
        throw new Error('Self-hosted endpoints can only be changed in the desktop app.')
      },
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_MANTA_PROFILE_ID,
          profiles: [createDefaultLocalMantaProfile(0)],
          profile: createDefaultLocalMantaProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webMantaProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webMantaProfileAuthStatus()
      }),
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webMantaProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webMantaProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_MANTA_PROFILE_ID,
        profiles: [createDefaultLocalMantaProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webMantaProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' })
    }
  }
}
