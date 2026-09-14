import { createNotificationStreamFilter } from './notification-stream-policy'
import { defineStreamingMethod, defineMethod } from '../core'
import {
  NotificationGetMissedSinceParams,
  NotificationRegisterPushParams,
  NotificationRegisterPushTokenParams,
  NotificationUnsubscribeParams,
  NotificationsSubscribeParams
} from '../../../../shared/rpc-contract/notifications-params'

// Why: monotonically increasing per-process counter eliminates the
// Date.now() collision that could fire when two near-simultaneous
// notifications.subscribe calls landed on the same millisecond.
let notificationsSubscriptionSeq = 0

// Legacy callers retain filtered socket alerts; push clients opt into the full event stream.
export const NOTIFICATION_METHODS = [
  defineStreamingMethod({
    name: 'notifications.subscribe',
    params: NotificationsSubscribeParams,
    handler: async (params, { runtime, connectionId }, emit) => {
      const shouldEmit = createNotificationStreamFilter(params?.includeDesktopSuppressed)
      await new Promise<void>((resolve) => {
        const unsubscribe = runtime.onNotificationDispatched((event) => {
          if (shouldEmit(event)) {
            emit(event)
          }
        })

        // Why: scope by per-ws connectionId + per-process counter so
        // concurrent subscribes never collide on the cleanup map.
        const seq = ++notificationsSubscriptionSeq
        const subscriptionId = `notifications-${connectionId ?? 'inproc'}-${seq}`
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )

        // Why: the epoch rides the ready frame so a reconnecting client learns the
        // counter lifetime BEFORE it sends its watermark to getMissedSince (#8591).
        emit({ type: 'ready', subscriptionId, epoch: runtime.getMobileNotificationEpoch() })
      })
    }
  }),
  defineMethod({
    name: 'notifications.unsubscribe',
    params: NotificationUnsubscribeParams,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  }),
  defineMethod({
    name: 'notifications.registerPushToken',
    params: NotificationRegisterPushTokenParams,
    // Why keyed by pairedDeviceId and not the socket: the token has to outlive
    // the connection to be worth anything, and pairedDeviceId is the revocable
    // identity that unpairing actually removes.
    handler: async (params, { pairedDeviceId, setDevicePushToken }) => {
      // Why throw rather than report a false: a successful response carrying
      // `registered: false` is indistinguishable from success to a caller that
      // only checks `ok`, and that is precisely how this shipped storing
      // nothing while both sides believed it had worked.
      if (!pairedDeviceId) {
        throw new Error('Push tokens can only be registered by a paired device.')
      }
      if (!setDevicePushToken) {
        throw new Error('This runtime cannot store push tokens.')
      }
      if (params.keyUnavailableReason) {
        // The only place this chain is observable from the desktop.
        console.warn('[push] device reported no encryption key:', params.keyUnavailableReason)
      }
      if (
        !setDevicePushToken(pairedDeviceId, {
          value: params.deviceToken,
          platform: params.platform,
          updatedAt: Date.now(),
          ...(params.encryptionKeyB64 ? { encryptionKeyB64: params.encryptionKeyB64 } : {})
        })
      ) {
        throw new Error('No such paired device.')
      }
      return { registered: true }
    }
  }),
  defineMethod({
    name: 'notifications.getMissedSince',
    params: NotificationGetMissedSinceParams,
    // Why: returns only notifications with seq > lastSeenSeq. The runtime owns
    // the monotonic seq, so this is the single source of truth for what the
    // client missed while its socket was reaped.
    handler: async (params, { runtime }) => {
      const missed = runtime.getMissedNotificationsSince(params.lastSeenSeq, params.epoch)
      return {
        notifications: missed.filter(
          createNotificationStreamFilter(params.includeDesktopSuppressed)
        ),
        epoch: runtime.getMobileNotificationEpoch(),
        ...(params.deliveredPushes
          ? { dismissedPushes: runtime.reconcileDismissedPushes(params.deliveredPushes) }
          : {})
      }
    }
  }),
  defineMethod({
    name: 'notifications.registerPush',
    params: NotificationRegisterPushParams,
    // Why: the registration is keyed by the revocable paired device identity, never
    // by anything the caller can assert, so an in-process or CLI caller has no device
    // to register and is refused outright.
    handler: async (params, { runtime, clientKind, pairedDeviceId }) => {
      if (clientKind !== 'mobile' || !pairedDeviceId) {
        return { registered: false, reason: 'not_mobile' }
      }
      // The paired identity is spread last so no parameter can ever override it.
      return await runtime.registerMobilePushDevice({ ...params, deviceId: pairedDeviceId })
    }
  }),
  defineMethod({
    name: 'notifications.testPush',
    params: null,
    handler: async (_params, { runtime, clientKind, pairedDeviceId }) => {
      if (clientKind !== 'mobile' || !pairedDeviceId) {
        return { accepted: false, reason: 'not_registered' }
      }
      return await runtime.testMobilePushDevice(pairedDeviceId)
    }
  }),
  defineMethod({
    name: 'notifications.unregisterPush',
    params: null,
    // Deleting the gateway token is durable (outbox), so an offline gateway still
    // reports success to the phone that asked to stop being pushed to.
    handler: async (_params, { runtime, clientKind, pairedDeviceId }) => {
      if (clientKind !== 'mobile' || !pairedDeviceId) {
        return { unregistered: false }
      }
      return await runtime.unregisterMobilePushDevice(pairedDeviceId)
    }
  })
]
