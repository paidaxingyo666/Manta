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
