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
  /**
   * Builds the lock-screen text.
   *
   * Injected because the desktop is the only party that knows a language: the
   * relay must not read the notification, and the phone ships no
   * Localizable.strings, so APNs loc-keys have nothing to resolve against and
   * iOS renders the key itself. The desktop's own UI language is the best
   * available guess, and the same person is at both ends.
   */
  text: (count: number) => { title: string; body: string }
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
          payload: pushPayload(this.deps.text(batch.length)),
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
 * Says that something happened, not what. The relay forwards this and cannot
 * read a notification's text, so real content has to wait for a payload that is
 * encrypted for the device and decrypted on it.
 *
 * Literal strings rather than APNs loc-keys: those resolve against the app's
 * Localizable.strings, which this app does not ship, and iOS renders the key
 * itself when the lookup fails — `push.activity.title` on the lock screen.
 */
function pushPayload(text: { title: string; body: string }): Record<string, unknown> {
  return {
    aps: {
      alert: { title: text.title, body: text.body },
      sound: 'default',
      // Tells iOS to hand this to the notification service extension, which is
      // what will decrypt real content once there is any to decrypt.
      'mutable-content': 1
    }
  }
}
