/**
 * A watcher binds once and holds that descriptor. When the file stops being the
 * one the agent writes, the watcher stays healthy and reports `watching: true`
 * with nothing to deliver — indistinguishable from an idle conversation. One
 * such bind sat unnoticed for seven hours.
 */
import { describe, expect, it, vi } from 'vitest'
import { watchForTranscriptRebind } from './transcript-rebind-watch'

const BOUND = '/p/old.jsonl'
const SUCCESSOR = { path: '/p/new.jsonl', sessionId: 'new-id' }

type Harness = {
  fire: () => Promise<void>
  onMoved: ReturnType<typeof vi.fn>
  findSuccessor: ReturnType<typeof vi.fn>
  stop: () => void
}

function harness(opts: { quietFor: number; successor?: typeof SUCCESSOR | null }): Harness {
  const pending: (() => void)[] = []
  const onMoved = vi.fn()
  const findSuccessor = vi.fn(async () => opts.successor ?? null)
  const watch = watchForTranscriptRebind({
    agent: 'claude',
    sessionId: 'old-id',
    boundPath: BOUND,
    onMoved,
    intervalMs: 1,
    quietBeforeSearchMs: 100,
    now: () => 1_000_000,
    mtimeMs: async () => 1_000_000 - opts.quietFor,
    findSuccessor: findSuccessor as never,
    setTimer: ((fn: () => void) => {
      pending.push(fn)
      return pending.length as never
    }) as never,
    clearTimer: (() => {}) as never
  })
  return {
    fire: async () => {
      const next = pending.shift()
      next?.()
      await vi.waitFor(() =>
        expect(findSuccessor.mock.calls.length + onMoved.mock.calls.length >= 0).toBe(true)
      )
      await new Promise((r) => setTimeout(r, 0))
    },
    onMoved,
    findSuccessor,
    stop: watch.stop
  }
}

describe('watchForTranscriptRebind', () => {
  it('rebinds to where a rolled session continued', async () => {
    const h = harness({ quietFor: 5_000, successor: SUCCESSOR })
    await h.fire()
    expect(h.onMoved).toHaveBeenCalledWith(SUCCESSOR)
    h.stop()
  })

  /**
   * The trigger is descent, never silence. An idle session must be left alone —
   * this is the check that stops the fix from yanking a reader out of a
   * conversation that was merely waiting on them.
   */
  it('leaves a quiet session with no successor alone', async () => {
    const h = harness({ quietFor: 5_000, successor: null })
    await h.fire()
    expect(h.onMoved).not.toHaveBeenCalled()
    h.stop()
  })

  // A live file is being written; searching its siblings is pure cost.
  it('does not even search while the bound file is being written', async () => {
    const h = harness({ quietFor: 1, successor: SUCCESSOR })
    await h.fire()
    expect(h.findSuccessor).not.toHaveBeenCalled()
    expect(h.onMoved).not.toHaveBeenCalled()
    h.stop()
  })

  // Only Claude rolls a session into a new file; the others keep appending.
  it('never searches for a non-Claude agent', async () => {
    const findSuccessor = vi.fn()
    const onMoved = vi.fn()
    const pending: (() => void)[] = []
    watchForTranscriptRebind({
      agent: 'codex',
      sessionId: 'old-id',
      boundPath: BOUND,
      onMoved,
      intervalMs: 1,
      quietBeforeSearchMs: 100,
      now: () => 1_000_000,
      mtimeMs: async () => 0,
      findSuccessor: findSuccessor as never,
      setTimer: ((fn: () => void) => {
        pending.push(fn)
        return pending.length as never
      }) as never,
      clearTimer: (() => {}) as never
    })
    pending.shift()?.()
    await new Promise((r) => setTimeout(r, 0))
    expect(findSuccessor).not.toHaveBeenCalled()
    expect(onMoved).not.toHaveBeenCalled()
  })

  // Dropping a live binding because one probe raced a rename would turn a
  // transient into an outage.
  it('keeps the current binding when the probe throws', async () => {
    const onMoved = vi.fn()
    const pending: (() => void)[] = []
    watchForTranscriptRebind({
      agent: 'claude',
      sessionId: 'old-id',
      boundPath: BOUND,
      onMoved,
      intervalMs: 1,
      quietBeforeSearchMs: 100,
      now: () => 1_000_000,
      mtimeMs: async () => {
        throw new Error('EACCES')
      },
      setTimer: ((fn: () => void) => {
        pending.push(fn)
        return pending.length as never
      }) as never,
      clearTimer: (() => {}) as never
    })
    pending.shift()?.()
    await new Promise((r) => setTimeout(r, 0))
    expect(onMoved).not.toHaveBeenCalled()
    // and it rescheduled rather than dying
    expect(pending.length).toBe(1)
  })

  it('stops searching once unsubscribed', async () => {
    const h = harness({ quietFor: 5_000, successor: SUCCESSOR })
    h.stop()
    await h.fire()
    expect(h.onMoved).not.toHaveBeenCalled()
  })
})
