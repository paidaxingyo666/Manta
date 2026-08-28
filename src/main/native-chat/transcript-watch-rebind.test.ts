/**
 * A compacted Claude session continues in a NEW file, and the id the watcher
 * holds still resolves to the OLD one — that file is exactly `<old-id>.jsonl`
 * and still exists. So the subscription stayed bound to a file nobody writes,
 * reported `watching: true`, and delivered nothing for seven hours: the chat
 * stopped at the dead file's last message, push kept re-announcing that same
 * message, and phone-sent messages never echoed back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  resolve: vi.fn(),
  findSuccessor: vi.fn(),
  mtimeMs: vi.fn()
}))

vi.mock('./session-file-resolver', () => ({ resolveSessionFilePath: mocks.resolve }))
vi.mock('./transcript-watch-engine', () => ({
  getActiveNativeChatWatcherCount: vi.fn(() => 0),
  installTranscriptWatcher: mocks.install
}))
vi.mock('./claude-transcript-successor', () => ({
  findSuccessorTranscript: mocks.findSuccessor
}))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  stat: async (path: string) => ({ mtimeMs: await mocks.mtimeMs(path) })
}))

import { subscribeNativeChatTranscript } from './transcript-watch'

const OLD = '/projects/p/old-id.jsonl'
const NEW = '/projects/p/new-id.jsonl'

function subscribe() {
  return subscribeNativeChatTranscript({
    agent: 'claude',
    sessionId: 'old-id',
    transcriptPath: OLD,
    resolvePollIntervalMs: 10,
    rebindCheckIntervalMs: 10,
    onAppend: () => {},
    onInitialSnapshot: () => {}
  })
}

describe('a watcher follows its session when the transcript rolls', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.install.mockReset()
    mocks.resolve.mockReset().mockResolvedValue(null)
    mocks.findSuccessor.mockReset().mockResolvedValue(null)
    // Long quiet, so the search is allowed to run.
    mocks.mtimeMs.mockReset().mockResolvedValue(0)
  })
  afterEach(() => vi.useRealTimers())

  it('reinstalls on the file the session continued into', async () => {
    const bound: string[] = []
    mocks.install.mockImplementation(async (filePath: string) => {
      bound.push(filePath)
      return { unsubscribe: () => {} }
    })
    mocks.findSuccessor.mockResolvedValue({ path: NEW, sessionId: 'new-id' })

    const sub = await subscribe()
    await vi.advanceTimersByTimeAsync(200)

    // Bound the hook's file first, then followed the session off it.
    expect(bound[0]).toBe(OLD)
    expect(bound.at(-1)).toBe(NEW)
    sub.unsubscribe()
  })

  /**
   * The trigger is descent, never silence. An idle session is quiet for hours
   * and must be left exactly where the reader put it.
   */
  it('leaves a merely idle session bound where it is', async () => {
    const bound: string[] = []
    mocks.install.mockImplementation(async (filePath: string) => {
      bound.push(filePath)
      return { unsubscribe: () => {} }
    })

    const sub = await subscribe()
    await vi.advanceTimersByTimeAsync(500)
    expect(bound).toEqual([OLD])
    sub.unsubscribe()
  })

  // Only the direct ancestor is replayed near enough to the top to be found, so
  // the id must advance or the second roll is invisible.
  it('searches under the new id after a rebind', async () => {
    mocks.install.mockResolvedValue({ unsubscribe: () => {} })
    mocks.findSuccessor.mockResolvedValueOnce({ path: NEW, sessionId: 'new-id' })

    const sub = await subscribe()
    await vi.advanceTimersByTimeAsync(300)

    const ids = mocks.findSuccessor.mock.calls.map((c) => (c[0] as { sessionId: string }).sessionId)
    expect(ids[0]).toBe('old-id')
    expect(ids.at(-1)).toBe('new-id')
    sub.unsubscribe()
  })

  // A caller that pinned one file did so on purpose.
  it('never moves a subscription that pinned an explicit file', async () => {
    mocks.install.mockResolvedValue({ unsubscribe: () => {} })
    mocks.findSuccessor.mockResolvedValue({ path: NEW, sessionId: 'new-id' })

    const sub = await subscribeNativeChatTranscript({
      agent: 'claude',
      sessionId: 'old-id',
      filePath: OLD,
      resolvePollIntervalMs: 10,
      rebindCheckIntervalMs: 10,
      onAppend: () => {},
      onInitialSnapshot: () => {}
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(mocks.findSuccessor).not.toHaveBeenCalled()
    sub.unsubscribe()
  })

  /**
   * The path the hook reports usually EXISTS — a rolled session's old file is
   * not deleted, it just stops growing. So the first install succeeds and the
   * subscribe returns straight from that fast path. A guard installed only on
   * the resolve-poll fallback is therefore absent in exactly the case it was
   * written for, which is how a watcher sat on a dead file for seven hours.
   */
  it('follows the roll even when the first install succeeds outright', async () => {
    const bound: string[] = []
    mocks.install.mockImplementation(async (filePath: string) => {
      bound.push(filePath)
      return { unsubscribe: () => {} }
    })
    // The hook's path resolves, so subscribe never reaches the poll fallback.
    mocks.resolve.mockResolvedValue(OLD)
    mocks.findSuccessor.mockResolvedValue({ path: NEW, sessionId: 'new-id' })

    const sub = await subscribe()
    await vi.advanceTimersByTimeAsync(200)

    expect(bound[0]).toBe(OLD)
    expect(bound.at(-1)).toBe(NEW)
    sub.unsubscribe()
  })

  it('stops searching once unsubscribed', async () => {
    mocks.install.mockResolvedValue({ unsubscribe: () => {} })
    const sub = await subscribe()
    await vi.advanceTimersByTimeAsync(50)
    sub.unsubscribe()
    mocks.findSuccessor.mockClear()
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.findSuccessor).not.toHaveBeenCalled()
  })
})
