import { describe, expect, it, vi } from 'vitest'
import { MobilePushEscalation, type PushEscalationDeps } from './mobile-push-escalation'

function harness(overrides: Partial<PushEscalationDeps> = {}) {
  let fire: (() => void) | null = null
  const wake = vi.fn().mockResolvedValue({ ok: true, discardToken: false })
  const forgetToken = vi.fn()
  const deps: PushEscalationDeps = {
    hasLiveSubscriber: () => false,
    pushTargets: () => [{ deviceId: 'dev-1', deviceToken: 'a'.repeat(64) }],
    wake,
    forgetToken,
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

  it('does not let a relay failure escape into the dispatch path', async () => {
    const h = harness()
    h.wake.mockRejectedValue(new Error('relay down'))
    h.escalation.schedule(notification('one'))

    await expect(h.elapse()).resolves.not.toThrow()
  })
})
