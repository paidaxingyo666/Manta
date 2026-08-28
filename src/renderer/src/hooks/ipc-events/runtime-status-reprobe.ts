import { replayClientHostedBrowserCloseIntents } from '@/runtime/client-hosted-browser-close-intent-replay'
import { ensureBrowserClientHostsForRestoredPages } from '@/runtime/restored-client-hosted-browser-host-attach'
import { refreshRuntimeEnvironmentStatus } from '@/store/slices/runtime-status-refresh'
import { useAppStore } from '../../store'

/** Same wait as the store's status action, so a re-probe is no more impatient than any status.get. */
const RUNTIME_STATUS_REPROBE_TIMEOUT_MS = 10_000

/**
 * Re-asks `status.get` after a reconnect and publishes only what it actually verified.
 *
 * The store's `refreshRuntimeEnvironmentStatus` records a failed probe as `null`, which is right
 * for a user-initiated check but wrong here: this probe dials its own short-lived socket with a
 * fresh handshake (`src/shared/remote-runtime-request-socket.ts`), so it can fail while the
 * control transport that just replayed is demonstrably alive. That failure is `unverifiable`, not
 * evidence the host is down — publishing it over a live cached verdict demotes the sidebar to
 * offline behind a "Can't reach" toast, which is the exact symptom this re-probe exists to cure.
 * A failed probe therefore leaves the cached verdict untouched and the caller's retry chain settles
 * it. Resolves to whether the host answered, so callers can drive that chain.
 */
export function dialRuntimeStatusReprobe(environmentId: string): Promise<boolean> {
  return refreshRuntimeEnvironmentStatus(
    environmentId,
    RUNTIME_STATUS_REPROBE_TIMEOUT_MS,
    (status) => {
      if (status === null) {
        return
      }
      useAppStore
        .getState()
        .setRuntimeEnvironmentStatus(environmentId, { status, checkedAt: Date.now() })
      // Mirrors the store action's recovery follow-ups: the host that just answered may be holding
      // pages this desktop hosts, and closes it never heard must not be lost to the reattach.
      void ensureBrowserClientHostsForRestoredPages(useAppStore.getState())
      void replayClientHostedBrowserCloseIntents(environmentId, useAppStore.getState())
    }
  )
}
