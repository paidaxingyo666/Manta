import type { MobileNotificationEvent } from './manta-runtime'
import { encryptPushBody, type EncryptedPushBody } from '../../shared/push-payload-encryption'

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
/**
 * APNs rejects a payload over 4 KB and the rest of the notification shares it.
 * Base64 costs a third on top, so this is the plaintext ceiling that keeps the
 * sealed result comfortably inside.
 */
const MAX_SEALED_PLAINTEXT_BYTES = 1_400

export type PushEscalationDeps = {
  /** True while any phone holds a live notification subscription. */
  hasLiveSubscriber: () => boolean
  /** Paired devices that have reported a push token. */
  pushTargets: () => readonly {
    deviceId: string
    deviceToken: string
    /** base64 of this device's push key, when it has published one. */
    encryptionKeyB64?: string
  }[]
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
          payload: pushPayload(
            this.deps.text(batch.length),
            sealedBody(target.encryptionKeyB64, batch),
            deliveredMark(batch)
          )
          // No apns-collapse-id. A constant one made every push replace the last
          // in Notification Center, so the phone only ever showed the newest
          // event and everything before it vanished. The burst it was meant to
          // tame is already handled above — a window's worth of notifications
          // leaves here as one push — and collapsing past that discards history
          // rather than condensing it.
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
function pushPayload(
  text: { title: string; body: string },
  sealed: EncryptedPushBody | null,
  delivered: DeliveredMark | null
): Record<string, unknown> {
  return {
    aps: {
      // The generic text is what shows if the extension does not run, cannot
      // decrypt, or is not installed — so it is the floor, not a placeholder.
      alert: { title: text.title, body: text.body },
      sound: 'default',
      // Tells iOS to hand this to the notification service extension, which is
      // what replaces the text above with what actually happened.
      'mutable-content': 1
    },
    ...(sealed ? { mb: sealed } : {}),
    ...(delivered ? { ds: delivered.seq, de: delivered.epoch } : {})
  }
}

/**
 * How far the phone's catch-up may skip once this push lands.
 *
 * Without it the watermark only ever advances on a live socket delivery, so
 * everything APNs showed while the app was closed is still missed-since-last-
 * connect on the next open and gets notified a second time. The extension
 * records this on arrival; the app folds it in before asking what it missed.
 *
 * The epoch travels with it because a seq only means anything inside one
 * counter lifetime — a desktop restart makes the number meaningless, and the
 * phone must not fold a stale one into a fresh counter.
 */
type DeliveredMark = { seq: number; epoch: string }

function deliveredMark(batch: readonly MobileNotificationEvent[]): DeliveredMark | null {
  let seq: number | null = null
  let epoch: string | null = null
  for (const event of batch) {
    if (event.type !== 'notification' || event.notificationSeq == null) {
      continue
    }
    if (seq === null || event.notificationSeq > seq) {
      seq = event.notificationSeq
      epoch = event.notificationEpoch ?? null
    }
  }
  // Why both: an event without an epoch predates the counter and cannot be
  // folded in safely, so it stays the phone's job to re-check rather than skip.
  return seq !== null && epoch !== null ? { seq, epoch } : null
}

/**
 * Seals what actually happened, for the extension to swap in.
 *
 * Absent until a device publishes a key. Absent too when the result would not
 * fit: APNs rejects a payload over 4 KB outright, and losing the whole
 * notification to say more about it is the wrong trade.
 */
function sealedBody(
  keyB64: string | undefined,
  batch: readonly MobileNotificationEvent[]
): EncryptedPushBody | null {
  if (!keyB64) {
    return null
  }
  // Filled item by item against the byte budget rather than built whole and
  // then measured. Slicing by JS characters and judging by base64 length means
  // CJK — three bytes per character — blows the budget at three notifications
  // and the whole body is discarded, silently, exactly when there is most to
  // say.
  //
  // Filled newest-first so the budget cuts the OLDEST: the line a lock screen
  // shows is the latest one, and filling forwards trimmed exactly that. The
  // array itself stays oldest-first, so an extension still reading items[0] is
  // unaffected by the change.
  const items: { t: string; b: string }[] = []
  for (let i = batch.length - 1; i >= 0; i--) {
    const event = batch[i]
    if (!event) {
      continue
    }
    items.unshift({
      t: clip('title' in event ? String(event.title ?? '') : '', 120),
      b: clip('body' in event ? String(event.body ?? '') : '', 200)
    })
    if (Buffer.byteLength(JSON.stringify(items), 'utf8') > MAX_SEALED_PLAINTEXT_BYTES) {
      items.shift()
      break
    }
  }
  if (items.length === 0) {
    return null
  }
  try {
    return encryptPushBody(Buffer.from(keyB64, 'base64'), JSON.stringify(items))
  } catch {
    // A malformed key must not cost the notification itself.
    return null
  }
}

/** Trims to a byte budget without splitting a multi-byte character. */
function clip(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text
  }
  let out = text
  while (Buffer.byteLength(out, 'utf8') > maxBytes) {
    out = out.slice(0, -1)
  }
  return out
}
