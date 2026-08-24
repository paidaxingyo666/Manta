import { describe, expect, it, vi } from 'vitest'
import { MobilePushEscalation, type PushEscalationDeps } from './mobile-push-escalation'
import { decryptPushBody, generatePushKey } from '../../shared/push-payload-encryption'

function harness(overrides: Partial<PushEscalationDeps> = {}) {
  let fire: (() => void) | null = null
  const wake = vi.fn().mockResolvedValue({ ok: true, discardToken: false })
  const forgetToken = vi.fn()
  const deps: PushEscalationDeps = {
    hasLiveSubscriber: () => false,
    pushTargets: () => [{ deviceId: 'dev-1', deviceToken: 'a'.repeat(64) }],
    wake,
    forgetToken,
    text: (count) => ({ title: 'Manta', body: count === 1 ? '有新动态' : `${count} 条新通知` }),
    setTimer: (fn) => {
      fire = fn
    },
    ...overrides
  }
  return {
    escalation: new MobilePushEscalation(deps),
    wake,
    forgetToken,
    elapse: async () => {
      fire?.()
      await vi.waitFor(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}

const notification = (title: string) =>
  ({ type: 'notification', source: 'agent', title, body: '' }) as never

describe('MobilePushEscalation', () => {
  it('pushes when nothing is listening', async () => {
    const h = harness()
    h.escalation.schedule(notification('one'))
    await h.elapse()

    expect(h.wake).toHaveBeenCalledTimes(1)
    expect(h.wake.mock.calls[0][0]).toMatchObject({ deviceToken: 'a'.repeat(64) })
  })

  /**
   * The reason the wait exists. A listening phone already has these down its
   * socket; pushing as well shows the user the same thing twice.
   */
  it('stays quiet when a phone is listening', async () => {
    const h = harness({ hasLiveSubscriber: () => true })
    h.escalation.schedule(notification('one'))
    await h.elapse()

    expect(h.wake).not.toHaveBeenCalled()
  })

  // Checked when the timer fires, not when the notification arrives: on iOS a
  // backgrounded socket dies and reconnects on its own, and that gap is not a
  // phone that is away.
  it('re-checks at the end of the wait, not the start', async () => {
    let listening = false
    const h = harness({ hasLiveSubscriber: () => listening })
    h.escalation.schedule(notification('one'))
    listening = true
    await h.elapse()

    expect(h.wake).not.toHaveBeenCalled()
  })

  // A burst of agent activity is one reason to look at the phone, not eight.
  it('collapses a burst into a single push', async () => {
    const h = harness()
    for (const title of ['a', 'b', 'c']) {
      h.escalation.schedule(notification(title))
    }
    await h.elapse()

    expect(h.wake).toHaveBeenCalledTimes(1)
    expect(h.wake.mock.calls[0][0].collapseId).toBe('manta-activity')
  })

  // iOS resolves loc-keys against the app's Localizable.strings, which this app
  // does not ship — so a loc-key reaches the lock screen as its own literal key.
  it('sends readable text, not APNs loc-keys', async () => {
    const h = harness()
    h.escalation.schedule(notification('one'))
    await h.elapse()

    const alert = h.wake.mock.calls[0][0].payload.aps.alert
    expect(alert).toEqual({ title: 'Manta', body: '有新动态' })
    expect(JSON.stringify(alert)).not.toContain('loc-key')
  })

  it('says how many when a burst collapsed', async () => {
    const h = harness()
    for (const t of ['a', 'b', 'c']) {
      h.escalation.schedule(notification(t))
    }
    await h.elapse()

    expect(h.wake.mock.calls[0][0].payload.aps.alert.body).toBe('3 条新通知')
  })

  it('tells iOS to invoke the service extension, so content can be added later', async () => {
    const h = harness()
    h.escalation.schedule(notification('one'))
    await h.elapse()

    expect(h.wake.mock.calls[0][0].payload.aps['mutable-content']).toBe(1)
  })

  // The relay stores nothing about devices, so a dead token only ever comes
  // back in this reply — and would otherwise be retried forever.
  it('forgets a token APNs reports as dead', async () => {
    const h = harness()
    h.wake.mockResolvedValue({ ok: false, discardToken: true })
    h.escalation.schedule(notification('one'))
    await h.elapse()

    expect(h.forgetToken).toHaveBeenCalledWith('dev-1')
  })

  it('keeps a token when the failure was transient', async () => {
    const h = harness()
    h.wake.mockResolvedValue({ ok: false, discardToken: false })
    h.escalation.schedule(notification('one'))
    await h.elapse()

    expect(h.forgetToken).not.toHaveBeenCalled()
  })

  it('ignores dismissals — there is nothing to announce', async () => {
    const h = harness()
    h.escalation.schedule({ type: 'dismiss', notificationId: 'x' } as never)
    await h.elapse()

    expect(h.wake).not.toHaveBeenCalled()
  })

  // The extension is the only thing that can read this, and only once a device
  // publishes a key. Until then the push is exactly what it was.
  it('carries no encrypted body for a device with no key', async () => {
    const h = harness()
    h.escalation.schedule(notification('one'))
    await h.elapse()

    expect(h.wake.mock.calls[0][0].payload.mb).toBeUndefined()
  })

  it('seals what happened for a device that published a key', async () => {
    const key = generatePushKey()
    const h = harness({
      pushTargets: () => [
        {
          deviceId: 'dev-1',
          deviceToken: 'a'.repeat(64),
          encryptionKeyB64: key.toString('base64')
        }
      ]
    })
    h.escalation.schedule(notification('agent 需要确认'))
    await h.elapse()

    const sealed = h.wake.mock.calls[0][0].payload.mb
    expect(sealed).toBeTruthy()
    expect(JSON.parse(decryptPushBody(key, sealed)!)[0].t).toBe('agent 需要确认')
  })

  // The generic text is the floor, not a placeholder: it is what shows if the
  // extension does not run, cannot decrypt, or is not installed at all.
  it('keeps readable generic text alongside the ciphertext', async () => {
    const key = generatePushKey()
    const h = harness({
      pushTargets: () => [
        { deviceId: 'd', deviceToken: 'a'.repeat(64), encryptionKeyB64: key.toString('base64') }
      ]
    })
    h.escalation.schedule(notification('one'))
    await h.elapse()

    expect(h.wake.mock.calls[0][0].payload.aps.alert).toEqual({ title: 'Manta', body: '有新动态' })
  })

  // Losing the whole notification to say more about it is the wrong trade;
  // APNs rejects anything over 4 KB outright.
  it('drops the ciphertext rather than the notification when it would not fit', async () => {
    const key = generatePushKey()
    const h = harness({
      pushTargets: () => [
        { deviceId: 'd', deviceToken: 'a'.repeat(64), encryptionKeyB64: key.toString('base64') }
      ]
    })
    for (let i = 0; i < 8; i += 1) {
      h.escalation.schedule({
        type: 'notification',
        source: 'agent',
        title: 'x'.repeat(200),
        body: 'y'.repeat(200)
      } as never)
    }
    await h.elapse()

    const payload = h.wake.mock.calls[0][0].payload
    expect(payload.mb).toBeUndefined()
    expect(payload.aps.alert.body).toBeTruthy()
  })

  it('survives a malformed key without losing the notification', async () => {
    const h = harness({
      pushTargets: () => [
        { deviceId: 'd', deviceToken: 'a'.repeat(64), encryptionKeyB64: 'not-a-key' }
      ]
    })
    h.escalation.schedule(notification('one'))
    await h.elapse()

    expect(h.wake).toHaveBeenCalledTimes(1)
    expect(h.wake.mock.calls[0][0].payload.mb).toBeUndefined()
  })

  it('does not let a relay failure escape into the dispatch path', async () => {
    const h = harness()
    h.wake.mockRejectedValue(new Error('relay down'))
    h.escalation.schedule(notification('one'))

    await expect(h.elapse()).resolves.not.toThrow()
  })
})
