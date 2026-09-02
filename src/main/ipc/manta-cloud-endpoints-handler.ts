import { app, ipcMain } from 'electron'
import type { Store } from '../persistence/loading-store/store'
import { normalizeMantaCloudEndpointOverrides } from '../../shared/manta-cloud-endpoints'
import { getProfileUserDataPath } from '../manta-profiles/profile-storage-paths'
import { signOutCurrentMantaProfile } from '../manta-profiles/profile-cloud-service'
import { relaunchApp } from '../app-relaunch'

export type RegisterMantaCloudEndpointHandlerOptions = {
  onBeforeSignOut?: () => void
  onBeforeRelaunch?: () => void | Promise<void>
}

/**
 * Switching to a self-hosted sign-in/relay server.
 *
 * Why a dedicated handler instead of a plain settings write: the order below is
 * load-bearing, and a relaunch is unavoidable because DesktopRelayService copies
 * the auth config into its closure at construction and never re-reads it.
 */
export function registerMantaCloudEndpointHandler(
  store: Store,
  options: RegisterMantaCloudEndpointHandlerOptions = {}
): void {
  ipcMain.handle(
    'mantaProfiles:applyCloudEndpoints',
    async (_event, rawArgs: unknown): Promise<{ status: 'restarting' }> => {
      const next = normalizeMantaCloudEndpointOverrides(rawArgs)
      // Why sign out first: signOutCurrentMantaProfile resolves the revoke URL
      // from the live config. Persisting the new endpoints first would send the
      // old refresh token to the new server — it cannot revoke the old session
      // and may trip a token-reuse alarm on the new one.
      options.onBeforeSignOut?.()
      await signOutCurrentMantaProfile(getProfileUserDataPath()).catch(() => undefined)
      store.updateSettings({ mantaCloudEndpoints: next })
      try {
        await options.onBeforeRelaunch?.()
      } catch (error) {
        console.warn(
          '[manta-cloud] Pre-relaunch cleanup failed; continuing endpoint switch:',
          error instanceof Error ? error.name : typeof error
        )
      }
      setTimeout(() => {
        relaunchApp('cloud-endpoint-change')
        // Why app.quit() (not app.exit): before-quit/will-quit still need to run
        // so PTYs, scrollback capture, and daemon checkpoints are not skipped.
        app.quit()
      }, 150)
      return { status: 'restarting' }
    }
  )
}
