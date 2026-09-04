import { app, powerMonitor } from 'electron'

import { getMantaCloudAuthConfig } from '../manta-profiles/profile-cloud-auth-config'
import { getProfileUserDataPath } from '../manta-profiles/profile-storage-paths'
import { MobilePushEscalation } from '../runtime/mobile-push-escalation'
import { DesktopRelayService } from '../runtime/relay/desktop-relay-service'
import {
  publishThisMachineToRelay,
  setRelayHostIdentityReader
} from '../runtime/relay/relay-host-directory'
import { deriveRelayHostId } from '../runtime/relay/relay-http-client'
import type { MantaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { translateMain } from '../i18n/main-i18n'
import { mainProcessState as state } from './main-process-state'

/**
 * Everything that makes this fork's relay work, in a file upstream does not
 * have.
 *
 * It used to live inline in the launch path, and twice a sync took upstream's
 * side of that file and left these calls behind — silently, because an orphaned
 * *call* is not a compile error the way an orphaned import is. Once the phone
 * could only be reached in the foreground; once the desktop stopped reaching the
 * relay at all. A fork-only module reduces the call site to one line that a
 * merge cannot quietly drop, and `fork-relay-wiring.test.ts` fails if it does.
 */
export function startDesktopRelay(runtimeRpc: MantaRuntimeRpcServer): void {
  const cloudAuth = getMantaCloudAuthConfig()
  if (cloudAuth.configured) {
    try {
      const relayService = new DesktopRelayService({
        authConfig: cloudAuth.config,
        userDataPath: getProfileUserDataPath(),
        appVersion: app.getVersion(),
        runtimeRpc,
        onStatus: (status) => {
          state.desktopRelayStatus = status
          state.mainWindow?.webContents.send('mobile:relayStatusChanged', status)
        }
      })
      state.desktopRelayService = relayService
      runtimeRpc.setMobileRelayPairingProvider({
        createPairingRelay: (relayDeviceId) => relayService.createPairingRelay(relayDeviceId),
        onDeviceRevokeQueued: (item) => relayService.onDeviceRevokeQueued(item),
        onDemandStateChanged: () => relayService.demandStateChanged(),
        getEndpoints: (context, params) => relayService.getEndpoints(context, params),
        provisionRelay: (context, params) => relayService.provisionRelay(context, params)
      })
      // The machine directory needs this id without opening a broker: a desktop
      // with nothing paired never holds one, and that is exactly the machine the
      // user is looking for from another computer.
      setRelayHostIdentityReader(() => {
        const keypair = runtimeRpc.getE2EEKeypair()
        return keypair ? deriveRelayHostId(keypair.publicKey) : null
      })
      void publishThisMachineToRelay(getProfileUserDataPath(), app.getVersion()).catch(() => {
        // Best effort: a relay that predates accounts, or a signed-out profile,
        // simply leaves this machine out of the list.
      })
      // Only now do all three pieces exist: the listener count lives on the
      // runtime, the tokens on the device registry, and the wake on the relay.
      // Without this the phone is only reachable while its app is in the
      // foreground — a backgrounded phone gets nothing, silently.
      state.runtime?.setPushEscalation(
        new MobilePushEscalation({
          hasLiveSubscriber: () => (state.runtime?.getMobileNotificationListenerCount() ?? 0) > 0,
          pushTargets: () =>
            (runtimeRpc.getDeviceRegistry()?.listDevices() ?? [])
              .filter((device) => device.scope === 'mobile' && device.pushToken)
              .map((device) => ({
                deviceId: device.deviceId,
                deviceToken: device.pushToken!.value,
                ...(device.pushToken!.encryptionKeyB64
                  ? { encryptionKeyB64: device.pushToken!.encryptionKeyB64 }
                  : {})
              })),
          wake: (input) => relayService.pushWake(input),
          forgetToken: (deviceId) => {
            runtimeRpc.getDeviceRegistry()?.clearPushToken(deviceId)
          },
          text: (count) => ({
            title: translateMain('main.push.activityTitle', 'Manta'),
            body:
              count === 1
                ? translateMain('main.push.activityBodyOne', 'New activity on your desktop')
                : translateMain('main.push.activityBodyMany', '{{count}} new notifications', {
                    count
                  })
          })
        })
      )
      relayService.start()
      // Why: sleeping past relay-token expiry kills the broker with no retry
      // timer; resume is the moment that state becomes recoverable.
      powerMonitor.on('resume', () => state.desktopRelayService?.ensureLive())
    } catch (error) {
      console.warn(
        '[relay] Desktop relay startup unavailable:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
