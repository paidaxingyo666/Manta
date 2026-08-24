import type { MobileNotificationEvent } from './manta-runtime'

/**
 * Decides when a notification has to travel as a push rather than down a socket.
 *
 * A phone with a live subscription already gets everything instantly; pushing to
 * it as well means the same thing twice — once on the lock screen and once in
 * the app. So a push is only for a phone that is not listening.
 *
 * The wait is what makes that judgement safe. On iOS a backgrounded socket dies
 * gradually and reconnects on its own, so "no listener right now" is routinely a
 * gap of a second or two rather than a phone that is actually away. Escalating
 * immediately would turn every one of those into a duplicate. Waiting trades a
 * few seconds of latency for that, which is the cheaper side: a notification
 * that arrives five seconds late still arrives, and one that arrives twice is a
 * defect the user feels every time.
 */

/** Long enough to outlast a routine reconnect, short enough to still feel prompt. */
const DEFAULT_ESCALATION_DELAY_MS = 4_000

export type PushEscalationDeps = {
  /** True while any phone holds a live notification subscription. */
  hasLiveSubscriber: () => boolean
  /** Paired devices that have reported a push token. */
  pushTargets: () => readonly { deviceId: string; deviceToken: string }[]
  /** Hands one wake to the relay. */
  wake: (input: {
    deviceToken: string
    payload: Record<string, unknown>
    collapseId?: string
  }) => Promise<{ ok: boolean; discardToken: boolean }>
  /** Called when APNs says the token is dead, so it is not retried forever. */
  forgetToken: (deviceId: string) => void
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
}

export class MobilePushEscalation {
  private pending: MobileNotificationEvent[] = []
  private armed = false

  constructor(private readonly deps: PushEscalationDeps) {}

  /**
   * Records a notification and arms the check. Batched deliberately: a burst of
   * agent activity is one reason to look at the phone, not eight.
   */
  schedule(event: MobileNotificationEvent): void {
    if (event.type !== 'notification') {
      return
    }
    this.pending.push(event)
    if (this.armed) {
      return
    }
    this.armed = true
    const setTimer = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms).unref?.())
    setTimer(() => {
      void this.flush()
    }, this.deps.delayMs ?? DEFAULT_ESCALATION_DELAY_MS)
  }

  private async flush(): Promise<void> {
    this.armed = false
    const batch = this.pending
    this.pending = []
    if (batch.length === 0 || this.deps.hasLiveSubscriber()) {
      // A listening phone already has these; pushing would double them.
      return
    }
    for (const target of this.deps.pushTargets()) {
      const result = await this.deps
        .wake({
          deviceToken: target.deviceToken,
          payload: pushPayload(batch),
          // One collapse id for the whole app: a phone that was away for an hour
          // should light up once, not once per queued notification.
          collapseId: 'manta-activity'
        })
        .catch(() => ({ ok: false, discardToken: false }))
      if (result.discardToken) {
        this.deps.forgetToken(target.deviceId)
      }
    }
  }
}

/**
 * Content-free on purpose, for now. The relay forwards this and cannot read a
 * notification's text — so until the payload is encrypted for the device and
 * decrypted on it, the lock screen says that something happened rather than
 * what.
 */
function pushPayload(batch: readonly MobileNotificationEvent[]): Record<string, unknown> {
  return {
    aps: {
      alert: {
        'title-loc-key': 'push.activity.title',
        'loc-key': batch.length === 1 ? 'push.activity.body.one' : 'push.activity.body.many',
        'loc-args': [String(batch.length)]
      },
      sound: 'default',
      // Tells iOS to hand this to the notification service extension, which is
      // what will decrypt real content once there is any to decrypt.
      'mutable-content': 1
    }
  }
}
