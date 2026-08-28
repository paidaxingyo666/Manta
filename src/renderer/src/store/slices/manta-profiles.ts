import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  MantaProfileAuthStatus,
  MantaProfileSummary,
  SwitchMantaProfileResult,
  TransferMantaProfileProjectArgs,
  TransferMantaProfileProjectResult
} from '../../../../shared/manta-profiles'
import type { AppState } from '../types'
import {
  createMantaProfilesAuthActions,
  type MantaProfilesAuthActions
} from './manta-profiles-auth-actions'

export type MantaProfilesSlice = MantaProfilesAuthActions & {
  mantaProfiles: MantaProfileSummary[]
  activeMantaProfileId: string | null
  mantaProfileAuthStatus: MantaProfileAuthStatus | null
  mantaProfilesMultiProfileUi: boolean
  mantaProfilesLoading: boolean
  mantaProfileSwitching: boolean
  mantaProfileConnecting: boolean
  fetchMantaProfiles: () => Promise<void>
  fetchMantaProfileAuthStatus: () => Promise<MantaProfileAuthStatus | null>
  createLocalMantaProfile: (name?: string) => Promise<MantaProfileSummary | null>
  switchMantaProfile: (profileId: string) => Promise<SwitchMantaProfileResult | null>
  transferMantaProfileProject: (
    args: TransferMantaProfileProjectArgs
  ) => Promise<TransferMantaProfileProjectResult | null>
}

export const createMantaProfilesSlice: StateCreator<AppState, [], [], MantaProfilesSlice> = (
  set,
  get,
  api
) => ({
  mantaProfiles: [],
  activeMantaProfileId: null,
  mantaProfileAuthStatus: null,
  mantaProfilesMultiProfileUi: false,
  mantaProfilesLoading: false,
  mantaProfileSwitching: false,
  mantaProfileConnecting: false,

  fetchMantaProfiles: async () => {
    set({ mantaProfilesLoading: true })
    try {
      const [state, authStatus] = await Promise.all([
        window.api.mantaProfiles.list(),
        window.api.mantaProfiles.authStatus()
      ])
      set({
        activeMantaProfileId: state.activeProfileId,
        mantaProfiles: state.profiles,
        mantaProfilesMultiProfileUi: state.multiProfileUi,
        mantaProfileAuthStatus: authStatus,
        mantaProfilesLoading: false
      })
    } catch (err) {
      console.error('Failed to fetch Manta profiles:', err)
      set({ mantaProfilesLoading: false })
    }
  },

  fetchMantaProfileAuthStatus: async () => {
    try {
      const authStatus = await window.api.mantaProfiles.authStatus()
      set({ mantaProfileAuthStatus: authStatus })
      return authStatus
    } catch (err) {
      console.error('Failed to fetch Manta profile auth status:', err)
      return null
    }
  },

  createLocalMantaProfile: async (name) => {
    try {
      const state = await window.api.mantaProfiles.createLocal({ name })
      set({
        activeMantaProfileId: state.activeProfileId,
        mantaProfiles: state.profiles
      })
      void get().fetchMantaProfileAuthStatus()
      return state.profile
    } catch (err) {
      console.error('Failed to create Manta profile:', err)
      toast.error(
        translate('auto.store.slices.manta.profiles.612f7f6861', 'Failed to create profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  ...createMantaProfilesAuthActions(set, get, api),

  switchMantaProfile: async (profileId) => {
    if (!profileId || profileId === get().activeMantaProfileId) {
      return { status: 'already-active' }
    }
    set({ mantaProfileSwitching: true })
    try {
      const result = await window.api.mantaProfiles.switchProfile({ profileId })
      if (result?.status !== 'relaunching') {
        // Why: only a relaunch may keep the switcher locked; a stale
        // "already-active" answer would otherwise disable it forever.
        set({ mantaProfileSwitching: false })
      }
      return result
    } catch (err) {
      console.error('Failed to switch Manta profile:', err)
      set({ mantaProfileSwitching: false })
      toast.error(
        translate('auto.store.slices.manta.profiles.7d4bc516ee', 'Failed to switch profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  transferMantaProfileProject: async (args) => {
    try {
      const result = await window.api.mantaProfiles.transferProject(args)
      if (result.status === 'duplicate-target') {
        toast.error(
          translate(
            'auto.store.slices.manta.profiles.f518e89aa5',
            'Project already exists in that profile'
          )
        )
      }
      if (result.status === 'transferred' && result.willRelaunch) {
        set({ mantaProfileSwitching: true })
      }
      return result
    } catch (err) {
      console.error('Failed to transfer Manta profile project:', err)
      toast.error(
        translate('auto.store.slices.manta.profiles.f03ae7f27b', 'Failed to transfer project'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  }
})
