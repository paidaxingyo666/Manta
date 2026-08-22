import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ListMantaRelayHostsResult,
  MantaRelayHostSummary
} from '../../../../shared/manta-relay-hosts'
import {
  SHARED_RELAY_SIGN_IN_METHODS,
  type MantaRelaySignInMethods
} from '../../../../shared/manta-relay-sign-in-methods'
import type { AppState } from '../types'

export type MantaRelayHostsSlice = {
  /** Null until asked; the relay decides which sign-in screen exists. */
  mantaRelaySignInMethods: MantaRelaySignInMethods | null
  fetchMantaRelaySignInMethods: () => Promise<void>
  mantaRelayHosts: MantaRelayHostSummary[]
  mantaRelayHostsLoading: boolean
  /** Null until the list has been fetched once. */
  mantaRelayHostsState: ListMantaRelayHostsResult['status'] | null
  fetchMantaRelayHosts: () => Promise<void>
  forgetMantaRelayHost: (relayHostId: string) => Promise<void>
}

export const createMantaRelayHostsSlice: StateCreator<AppState, [], [], MantaRelayHostsSlice> = (
  set
) => {
  const apply = (result: ListMantaRelayHostsResult): void => {
    set({
      mantaRelayHostsLoading: false,
      mantaRelayHostsState: result.status,
      mantaRelayHosts: result.status === 'ok' ? result.hosts : []
    })
  }
  return {
    mantaRelaySignInMethods: null,
    mantaRelayHosts: [],
    mantaRelayHostsLoading: false,
    mantaRelayHostsState: null,

    fetchMantaRelaySignInMethods: async () => {
      try {
        set({ mantaRelaySignInMethods: await window.api.mantaProfiles.relaySignInMethods() })
      } catch (err) {
        console.error('Failed to read relay sign-in methods:', err)
        // Shared is what a relay that cannot answer is, and it is the screen
        // that works either way: no password form for credentials that may
        // not exist.
        set({ mantaRelaySignInMethods: SHARED_RELAY_SIGN_IN_METHODS })
      }
    },

    fetchMantaRelayHosts: async () => {
      set({ mantaRelayHostsLoading: true })
      try {
        apply(await window.api.mantaProfiles.listRelayHosts())
      } catch (err) {
        console.error('Failed to list relay machines:', err)
        set({ mantaRelayHostsLoading: false, mantaRelayHostsState: 'failed', mantaRelayHosts: [] })
      }
    },

    forgetMantaRelayHost: async (relayHostId) => {
      set({ mantaRelayHostsLoading: true })
      try {
        const result = await window.api.mantaProfiles.forgetRelayHost({ relayHostId })
        apply(result)
        if (result.status === 'ok') {
          toast.success(
            translate('auto.store.slices.mantaRelayHosts.forgotten', 'Machine removed from relay')
          )
        } else {
          toast.error(
            translate(
              'auto.store.slices.mantaRelayHosts.forgetFailed',
              'Could not remove that machine'
            )
          )
        }
      } catch (err) {
        console.error('Failed to forget relay machine:', err)
        set({ mantaRelayHostsLoading: false })
        toast.error(
          translate(
            'auto.store.slices.mantaRelayHosts.forgetFailed',
            'Could not remove that machine'
          ),
          { description: err instanceof Error ? err.message : String(err) }
        )
      }
    }
  }
}
