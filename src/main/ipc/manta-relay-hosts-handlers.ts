import { ipcMain } from 'electron'
import type {
  ForgetMantaRelayHostArgs,
  ForgetMantaRelayHostResult,
  ListMantaRelayHostsResult
} from '../../shared/manta-relay-hosts'
import { getProfileUserDataPath } from '../manta-profiles/profile-storage-paths'
import type { MantaRelaySignInMethods } from '../../shared/manta-relay-sign-in-methods'
import {
  forgetRelayHostForAccount,
  listRelayHostsForAccount,
  readRelaySignInMethods
} from '../runtime/relay/relay-host-directory'

/** The machines the signed-in account has on its relay. */
export function registerMantaRelayHostHandlers(): void {
  ipcMain.handle(
    'mantaRelay:signInMethods',
    (): Promise<MantaRelaySignInMethods> => readRelaySignInMethods()
  )

  ipcMain.handle(
    'mantaRelay:listHosts',
    (): Promise<ListMantaRelayHostsResult> => listRelayHostsForAccount(getProfileUserDataPath())
  )

  ipcMain.handle(
    'mantaRelay:forgetHost',
    (_event, rawArgs?: ForgetMantaRelayHostArgs): Promise<ForgetMantaRelayHostResult> => {
      // The renderer is outside the trust boundary; the relay checks ownership
      // again, so the only job here is refusing something that is not an id.
      const relayHostId =
        typeof rawArgs?.relayHostId === 'string' ? rawArgs.relayHostId.slice(0, 64) : ''
      return relayHostId
        ? forgetRelayHostForAccount(getProfileUserDataPath(), relayHostId)
        : Promise.resolve({ status: 'failed', error: 'invalid_relay_host_id' })
    }
  )
}
