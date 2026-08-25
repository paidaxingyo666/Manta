import { z } from 'zod'
import { defineStreamingMethod, defineMethod, type RpcAnyMethod } from '../core'

// Why: monotonically increasing per-process counter eliminates the
// Date.now() collision that could fire when two near-simultaneous
// notifications.subscribe calls landed on the same millisecond.
let notificationsSubscriptionSeq = 0

/**
 * The phone reports its APNs token so the desktop can reach it while its socket
 * is gone — which is every time the phone is asleep, and the reason a
 * notification used to wait for the app to be opened.
 *
 * Hex, bounded: this value becomes a URL path segment on the way to Apple.
 */
const RegisterPushTokenParams = z.object({
  deviceToken: z.string().regex(/^[0-9a-f]{64,200}$/, 'APNs device tokens are lowercase hex'),
  platform: z.literal('ios'),
  /**
   * base64 of the 32-byte key this device will open a sealed push body with.
   * Optional: a build without the notification service extension has nowhere to
   * keep one, and its pushes stay generic rather than failing.
   */
  encryptionKeyB64: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/, 'expected base64 of 32 bytes')
    .optional(),
  /** Set instead of the key when the phone could not produce one, naming the step that failed. */
  keyUnavailableReason: z.string().max(200).optional()
})

const NotificationUnsubscribeParams = z.object({
  subscriptionId: z
    .unknown()
    .transform((value) => (typeof value === 'string' && value.length > 0 ? value : ''))
    .pipe(z.string().min(1, 'Missing subscriptionId'))
})

// Why: notifications.getMissedSince is the catch-up RPC for mobile reconnect
// (#8129). The client passes the highest seq it has already delivered; the
// runtime returns only notifications dispatched after that seq. Because the
// desktop assigns a monotonic seq to every dispatched notification, the cut is
// exact and idempotent — re-requesting with the same watermark can never
// return an already-delivered event, so reconnects never duplicate local
// pushes (the adversarial-review gate for #8129).
// `epoch` names the counter lifetime lastSeenSeq came from (#8591). The desktop's
// seq restarts at 0 on every launch while the client's watermark is persisted, so
// without it a post-restart watermark silently cuts away everything. Optional: a
// client that predates the field keeps the seq-only cut.
const NotificationGetMissedSinceParams = z.object({
  lastSeenSeq: z.number().int().min(0, 'lastSeenSeq must be a non-negative integer'),
  epoch: z.string().optional()
})

// Why: notifications.subscribe streams desktop notification events to mobile
// clients over WebSocket. The mobile client shows a local push notification
// for each event. This avoids requiring Firebase/APNs — the existing
// persistent WebSocket connection doubles as the push channel.
export const NOTIFICATION_METHODS: readonly RpcAnyMethod[] = [
  defineStreamingMethod({
    name: 'notifications.subscribe',
    params: null,
    handler: async (_params, { runtime, connectionId }, emit) => {
      await new Promise<void>((resolve) => {
        const unsubscribe = runtime.onNotificationDispatched((event) => {
          emit(event)
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
    params: RegisterPushTokenParams,
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
      return { notifications: missed, epoch: runtime.getMobileNotificationEpoch() }
    }
  })
]
