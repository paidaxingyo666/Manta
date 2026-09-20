import type { StateCreator } from 'zustand'
import type { ConnectCurrentMantaProfileArgs } from '../../../../shared/manta-cloud-credentials'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ConnectCurrentMantaProfileResult,
  CreateCloudLinkedMantaProfileResult,
  RefreshCurrentMantaProfileAuthResult,
  SelectMantaProfileOrgResult,
  SignOutCurrentMantaProfileResult
} from '../../../../shared/manta-profiles'
import type { AppState } from '../types'

export type MantaProfilesAuthActions = {
  createCloudLinkedMantaProfile: (args: {
    orgId?: string
    name?: string
  }) => Promise<CreateCloudLinkedMantaProfileResult | null>
  connectCurrentMantaProfile: (
    args?: ConnectCurrentMantaProfileArgs
  ) => Promise<ConnectCurrentMantaProfileResult | null>
  refreshCurrentMantaProfileAuth: () => Promise<RefreshCurrentMantaProfileAuthResult | null>
  signOutCurrentMantaProfile: () => Promise<SignOutCurrentMantaProfileResult | null>
  selectMantaProfileOrg: (orgId: string) => Promise<SelectMantaProfileOrgResult | null>
}

// Why a separate module: the cloud-auth actions share the profiles slice's
// state keys but form their own cohesive surface (connect/refresh/sign-out/
// org selection), and the combined slice file exceeded the repo line budget.
export const createMantaProfilesAuthActions: StateCreator<
  AppState,
  [],
  [],
  MantaProfilesAuthActions
> = (set, get) => {
  let nextConnectAttempt = 0
  let appliedConnectAttempt = 0

  return {
    createCloudLinkedMantaProfile: async (args) => {
      try {
        const result = await window.api.mantaProfiles.createCloudLinked(args)
        set({
          mantaProfileAuthStatus: result.auth,
          ...(result.status === 'created'
            ? {
                activeMantaProfileId: result.activeProfileId,
                mantaProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'created') {
          toast.success(
            translate('auto.store.slices.manta.profiles.319d7cf39b', 'Cloud profile created')
          )
        } else if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.manta.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.manta.profiles.f0c9e11a6d',
              'Failed to create cloud profile'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to create Manta cloud profile:', err)
        toast.error(
          translate(
            'auto.store.slices.manta.profiles.f0c9e11a6d',
            'Failed to create cloud profile'
          ),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    connectCurrentMantaProfile: async (args) => {
      const attempt = ++nextConnectAttempt
      try {
        // Why: a pending browser callback must not block retry. Another click
        // starts a second PKCE wait; an older wait is ignored after a newer
        // one has already linked.
        const result = await window.api.mantaProfiles.connectCurrent(args)
        if (attempt < appliedConnectAttempt) {
          return result
        }
        const alreadyConnected = get().mantaProfileAuthStatus?.state === 'connected'
        set({
          mantaProfileAuthStatus: result.auth,
          ...(result.status === 'connected'
            ? {
                activeMantaProfileId: result.activeProfileId,
                mantaProfiles: result.profiles,
                mantaRelayHosts: [],
                mantaRelayHostsState: null
              }
            : {})
        })
        if (result.status === 'connected') {
          appliedConnectAttempt = attempt
          void get().fetchMantaRelayHosts()
          if (!alreadyConnected) {
            toast.success(
              translate('auto.store.slices.manta.profiles.9fcb07a796', 'Profile connected')
            )
          }
        } else if (result.status === 'unconfigured') {
          toast.error(
            translate(
              'auto.store.slices.manta.profiles.8b8fa73174',
              'Manta Cloud sign-in is not configured'
            ),
            {
              description: result.auth.setupMessage
            }
          )
        } else if (
          result.status === 'failed' &&
          !alreadyConnected &&
          result.auth.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.manta.profiles.33290e88ed', 'Failed to connect profile'),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to connect Manta profile:', err)
        if (
          attempt >= appliedConnectAttempt &&
          get().mantaProfileAuthStatus?.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.manta.profiles.33290e88ed', 'Failed to connect profile'),
            {
              description: err instanceof Error ? err.message : String(err)
            }
          )
        }
        return null
      }
    },

    refreshCurrentMantaProfileAuth: async () => {
      try {
        const result = await window.api.mantaProfiles.refreshAuth()
        set({
          mantaProfileAuthStatus: result.auth,
          ...(result.status === 'refreshed'
            ? {
                activeMantaProfileId: result.activeProfileId,
                mantaProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.manta.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.manta.profiles.2f6c78a039',
              'Failed to refresh profile auth'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to refresh Manta profile auth:', err)
        toast.error(
          translate(
            'auto.store.slices.manta.profiles.2f6c78a039',
            'Failed to refresh profile auth'
          ),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    signOutCurrentMantaProfile: async () => {
      const attempt = ++nextConnectAttempt
      appliedConnectAttempt = attempt
      try {
        const result = await window.api.mantaProfiles.signOutCurrent()
        if (attempt < appliedConnectAttempt) {
          return result
        }
        set({
          activeMantaProfileId: result.activeProfileId,
          mantaProfiles: result.profiles,
          mantaProfileAuthStatus: result.auth,
          ...(result.auth.state !== 'connected'
            ? { mantaRelayHosts: [], mantaRelayHostsState: null }
            : {})
        })
        if (result.auth.state !== 'connected') {
          toast.success(
            translate('auto.store.slices.manta.profiles.a37b5e6d37', 'Signed out of profile')
          )
        }
        return result
      } catch (err) {
        console.error('Failed to sign out of Manta profile:', err)
        toast.error(
          translate('auto.store.slices.manta.profiles.83600521e7', 'Failed to sign out'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    selectMantaProfileOrg: async (orgId) => {
      try {
        const result = await window.api.mantaProfiles.selectOrg({ orgId })
        set({
          mantaProfileAuthStatus: result.auth,
          ...(result.status === 'selected'
            ? {
                activeMantaProfileId: result.activeProfileId,
                mantaProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.manta.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.manta.profiles.76deec8f58',
              'Failed to switch organization'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to switch Manta profile org:', err)
        toast.error(
          translate('auto.store.slices.manta.profiles.76deec8f58', 'Failed to switch organization'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    }
  }
}
