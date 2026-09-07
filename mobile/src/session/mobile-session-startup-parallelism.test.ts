import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileSessionStartup } from './use-mobile-session-startup'
import type { MobileSessionKeyboardStateModel } from './use-mobile-session-keyboard-state'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (e: Error) => void }

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type StartupCall = { rpc: 'session.tabs.list' | 'terminal.list'; worktreeId: string }

// One session's worth of scope: only the fields useMobileSessionStartup actually reads, plus
// the two reads under test wired to deferreds so a test controls exactly when they settle.
function makeScope(worktreeId: string, calls: StartupCall[], protocolVerified = true) {
  const tabs = defer<void>()
  const terminals = defer<boolean>()
  const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: {} })
  const scope = {
    hostId: 'host-1',
    worktreeId,
    created: '0',
    isFloatingWorkspaceRoute: false,
    connState: 'connected',
    client: { sendRequest },
    protocolVerified,
    setTerminals: vi.fn(),
    terminalsRef: { current: [] },
    setSessionTabs: vi.fn(),
    appliedSnapshotMarkerRef: { current: { epoch: null, version: -1 } },
    closedTabTombstonesRef: { current: new Map() },
    setTerminalsLoaded: vi.fn(),
    setActiveHandle: vi.fn(),
    setActiveSessionTabId: vi.fn(),
    setMarkdownDocs: vi.fn(),
    setFileDocs: vi.fn(),
    terminalGestureInputQueuesRef: { current: new Map() },
    terminalGestureInputInFlightRef: { current: new Set() },
    sessionTabActionSheetKeyboardHideSubRef: { current: null },
    sessionTabActionSheetRequestSeqRef: { current: 0 },
    initializedHandlesRef: { current: new Set<string>() },
    terminalDiagnosticsRef: { current: { resetRoute: vi.fn() } },
    activeHandleRef: { current: null },
    activeSessionTabTypeRef: { current: null },
    pendingActiveSessionTabIdRef: { current: null },
    selectedSessionTabIdRef: { current: null },
    pendingActiveTerminalHandleRef: { current: null },
    pendingBrowserFocusPageIdRef: { current: null },
    pendingTerminalActivationAttemptRef: { current: null },
    initialSessionAutoCreateRef: { current: null },
    bufferedTerminalDraftState: { resetDrafts: vi.fn(), clearPendingRestorations: vi.fn() },
    clearPendingLiveInputCommit: vi.fn(),
    clearDelayedActionTimers: vi.fn(),
    showToast: vi.fn(),
    clearTerminalCache: vi.fn(),
    fetchTerminals: vi.fn(() => {
      calls.push({ rpc: 'terminal.list', worktreeId })
      return terminals.promise
    }),
    ensureSessionTabs: vi.fn(() => {
      calls.push({ rpc: 'session.tabs.list', worktreeId })
      return tabs.promise
    })
  }
  return {
    scope: scope as unknown as MobileSessionKeyboardStateModel,
    tabs,
    terminals,
    sendRequest,
    activateCalls: () =>
      sendRequest.mock.calls.filter(([method]) => method === 'worktree.activate').length
  }
}

function StartupHarness({
  scope
}: {
  scope: MobileSessionKeyboardStateModel
}): ReactElement | null {
  useMobileSessionStartup(scope)
  return null
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('mobile session startup parallelism', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('puts session.tabs.list and terminal.list on the wire together', async () => {
    const calls: StartupCall[] = []
    const { scope } = makeScope('wt-1', calls)

    await act(async () => {
      renderer = create(createElement(StartupHarness, { scope }))
      await Promise.resolve()
    })
    await flush()

    // Neither deferred has settled, so both requests are in flight at the same moment. Under the
    // old chain the second call could not have been made until the first resolved.
    expect(calls).toEqual([
      { rpc: 'session.tabs.list', worktreeId: 'wt-1' },
      { rpc: 'terminal.list', worktreeId: 'wt-1' }
    ])
  })

  it('isolates each read so one rejection cannot strand the follow-up refreshes', async () => {
    const calls: StartupCall[] = []
    const { scope, tabs, terminals } = makeScope('wt-1', calls)

    await act(async () => {
      renderer = create(createElement(StartupHarness, { scope }))
      await Promise.resolve()
    })
    await flush()

    await act(async () => {
      tabs.reject(new Error('tabs rejected'))
      terminals.reject(new Error('terminals rejected'))
      await Promise.resolve()
    })
    await flush()

    await act(async () => {
      vi.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    // The 750 ms and 1500 ms follow-up refreshes still armed despite both rejections; an
    // unguarded await would have thrown out of the startup block and armed neither.
    expect(calls.filter((call) => call.rpc === 'terminal.list')).toHaveLength(3)
  })

  it('drops results that land after the route moved to another session', async () => {
    const calls: StartupCall[] = []
    const first = makeScope('wt-1', calls)
    const second = makeScope('wt-2', calls)

    await act(async () => {
      renderer = create(createElement(StartupHarness, { scope: first.scope }))
      await Promise.resolve()
    })
    await flush()

    await act(async () => {
      renderer?.update(createElement(StartupHarness, { scope: second.scope }))
      await Promise.resolve()
    })
    await flush()

    // The first session's reads land only now, after its effect was torn down.
    await act(async () => {
      first.tabs.resolve(undefined)
      first.terminals.resolve(true)
      await Promise.resolve()
    })
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(1600)
      await Promise.resolve()
    })

    // Why: a stale settlement must not schedule refreshes for a worktree the route has left.
    expect(calls.filter((call) => call.worktreeId === 'wt-1')).toHaveLength(2)
  })

  it('withholds worktree.activate until the compatibility verdict lands', async () => {
    const calls: StartupCall[] = []
    const pending = makeScope('wt-1', calls, false)

    await act(async () => {
      renderer = create(createElement(StartupHarness, { scope: pending.scope }))
      await Promise.resolve()
    })
    await flush()

    // Why: a desktop that omits protocolVersion evaluates as version 0 and IS blocked, so the
    // routes that now mount pre-verdict must not mutate a host the gate is about to refuse.
    expect(pending.activateCalls()).toBe(0)
    // The reads are not held back with it; that is the whole point of mounting early.
    expect(calls).toHaveLength(2)
  })

  it('activates once the verdict lands without re-issuing the reads', async () => {
    const calls: StartupCall[] = []
    const pending = makeScope('wt-1', calls, false)

    await act(async () => {
      renderer = create(createElement(StartupHarness, { scope: pending.scope }))
      await Promise.resolve()
    })
    await flush()
    expect(pending.activateCalls()).toBe(0)

    // Same session, verdict now proven: only the activation effect may re-run.
    const verified = {
      ...(pending.scope as unknown as Record<string, unknown>),
      protocolVerified: true
    } as unknown as MobileSessionKeyboardStateModel
    await act(async () => {
      renderer?.update(createElement(StartupHarness, { scope: verified }))
      await Promise.resolve()
    })
    await flush()

    expect(pending.activateCalls()).toBe(1)
    expect(pending.sendRequest).toHaveBeenCalledWith('worktree.activate', {
      worktree: 'id:wt-1',
      notifyClients: false,
      navigation: 'caller'
    })
    expect(calls).toHaveLength(2)
  })

  it('discards both parallel results when the session changes mid-flight', async () => {
    const calls: StartupCall[] = []
    const first = makeScope('wt-1', calls)
    const second = makeScope('wt-2', calls)

    await act(async () => {
      renderer = create(createElement(StartupHarness, { scope: first.scope }))
      await Promise.resolve()
    })
    await flush()
    expect(calls.filter((call) => call.worktreeId === 'wt-1')).toHaveLength(2)

    await act(async () => {
      renderer?.update(createElement(StartupHarness, { scope: second.scope }))
      await Promise.resolve()
    })
    await flush()

    // Tabs land late first, then terminals, so each is separately proven inert.
    await act(async () => {
      first.tabs.resolve(undefined)
      await Promise.resolve()
    })
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    expect(calls.filter((call) => call.worktreeId === 'wt-1')).toHaveLength(2)

    await act(async () => {
      first.terminals.resolve(true)
      await Promise.resolve()
    })
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(1600)
      await Promise.resolve()
    })
    expect(calls.filter((call) => call.worktreeId === 'wt-1')).toHaveLength(2)
  })
})
