import { useEffect } from 'react'
import type { RpcSuccess } from '../transport/types'
import { headlessActivationNeedsHostRenderer } from '../worktree/worktree-activation-result'
import { createInitialSessionAutoCreateState } from './use-initial-session-terminal-autocreate'
import type { MobileSessionKeyboardStateModel } from './use-mobile-session-keyboard-state'

export function useMobileSessionStartup(scope: MobileSessionKeyboardStateModel) {
  const {
    hostId,
    worktreeId,
    created,
    isFloatingWorkspaceRoute,
    connState,
    client,
    protocolVerified,
    setTerminals,
    terminalsRef,
    setSessionTabs,
    appliedSnapshotMarkerRef,
    closedTabTombstonesRef,
    setTerminalsLoaded,
    setActiveHandle,
    setActiveSessionTabId,
    setMarkdownDocs,
    setFileDocs,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    sessionTabActionSheetKeyboardHideSubRef,
    sessionTabActionSheetRequestSeqRef,
    initializedHandlesRef,
    terminalDiagnosticsRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    pendingActiveSessionTabIdRef,
    selectedSessionTabIdRef,
    pendingActiveTerminalHandleRef,
    pendingBrowserFocusPageIdRef,
    pendingTerminalActivationAttemptRef,
    initialSessionAutoCreateRef,
    bufferedTerminalDraftState,
    clearPendingLiveInputCommit,
    clearDelayedActionTimers,
    showToast,
    clearTerminalCache,
    fetchTerminals,
    ensureSessionTabs
  } = scope
  useEffect(() => {
    // Why: Expo reuses this screen across worktrees; reset route state so it can't open stale UI or reject the next snapshot.
    sessionTabActionSheetRequestSeqRef.current += 1
    sessionTabActionSheetKeyboardHideSubRef.current?.remove()
    sessionTabActionSheetKeyboardHideSubRef.current = null
    clearTerminalCache()
    activeHandleRef.current = null
    activeSessionTabTypeRef.current = null
    pendingActiveSessionTabIdRef.current = null
    selectedSessionTabIdRef.current = null
    pendingActiveTerminalHandleRef.current = null
    pendingBrowserFocusPageIdRef.current = null
    pendingTerminalActivationAttemptRef.current = null
    initialSessionAutoCreateRef.current = createInitialSessionAutoCreateState()
    terminalDiagnosticsRef.current.resetRoute()
    appliedSnapshotMarkerRef.current = { epoch: null, version: -1 }
    closedTabTombstonesRef.current.clear()
    bufferedTerminalDraftState.resetDrafts()
    for (const queued of terminalGestureInputQueuesRef.current.values()) {
      if (queued.timer) {
        clearTimeout(queued.timer)
      }
    }
    terminalGestureInputQueuesRef.current.clear()
    terminalGestureInputInFlightRef.current.clear()
    setActiveHandle(null)
    setTerminals([])
    terminalsRef.current = []
    setSessionTabs([])
    setActiveSessionTabId(null)
    clearPendingLiveInputCommit()
    setMarkdownDocs(new Map())
    setFileDocs(new Map())
    clearDelayedActionTimers()
    return () => {
      sessionTabActionSheetRequestSeqRef.current += 1
      sessionTabActionSheetKeyboardHideSubRef.current?.remove()
      bufferedTerminalDraftState.clearPendingRestorations()
      clearPendingLiveInputCommit()
      clearDelayedActionTimers()
    }
  }, [
    clearDelayedActionTimers,
    clearPendingLiveInputCommit,
    bufferedTerminalDraftState.clearPendingRestorations,
    clearTerminalCache,
    hostId,
    bufferedTerminalDraftState.resetDrafts,
    worktreeId
  ])

  // Reads only. They carry no side effect on the host, so they do not wait on the compatibility
  // verdict — that is the whole point of mounting this route while status.get is still in flight.
  // Every setTimeout goes through addTimer into `timers`, which the returned cleanup clears.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (connState !== 'connected') {
      return
    }
    // Why: keep the current xterm visible while the reconnect snapshot hydrates, not a blank "Loading terminals" surface.
    if (initializedHandlesRef.current.size === 0) {
      setTerminalsLoaded(false)
    }
    // Why: clear the initialized flag so the reconnect scrollback replaces stale content instead of being dropped.
    initializedHandlesRef.current.clear()
    let disposed = false
    const timers: ReturnType<typeof setTimeout>[] = []
    function addTimer(fn: () => void, ms: number) {
      if (disposed) {
        return
      }
      timers.push(setTimeout(fn, ms))
    }
    void (async () => {
      // Why: session.tabs.list and terminal.list are independent reads, so issue both now and
      // wait for the pair. Serialising them cost a full extra round trip before the first
      // terminal could paint, which on a far relay cell is seconds, not milliseconds. Each
      // call keeps its own catch so one rejection cannot strand the other's follow-up refreshes.
      await Promise.all([
        ensureSessionTabs().catch(() => null),
        fetchTerminals({ allowEmptyLoaded: false }).catch(() => false)
      ])
      if (disposed) {
        return
      }
      addTimer(() => void fetchTerminals({ allowEmptyLoaded: false }), 750)
      addTimer(() => void fetchTerminals({ allowEmptyLoaded: true }), 1500)
    })()
    return () => {
      disposed = true
      for (const t of timers) {
        clearTimeout(t)
      }
    }
    // Why no client/worktreeId here: both reads are useCallbacks that already list them, so a
    // host or worktree change replaces their identity and re-runs this effect with them.
  }, [connState, fetchTerminals, ensureSessionTabs])

  // worktree.activate writes host state, so unlike the reads above it waits for the compatibility
  // verdict. A missing protocolVersion reads as 0 and is blocked, so "pending" is not a formality:
  // mounting early must not let this route mutate a host the gate is about to refuse.
  // Every setTimeout goes through addTimer into `timers`, which the returned cleanup clears.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (connState !== 'connected' || !client || !protocolVerified || isFloatingWorkspaceRoute) {
      return
    }
    let disposed = false
    const timers: ReturnType<typeof setTimeout>[] = []
    function addTimer(fn: () => void, ms: number) {
      if (disposed) {
        return
      }
      timers.push(setTimeout(fn, ms))
    }
    const activateWorktree = () =>
      client
        .sendRequest('worktree.activate', {
          worktree: `id:${worktreeId}`,
          notifyClients: false,
          navigation: 'caller'
        })
        .catch(() => null)
    const reportActivationOutcome = (response: RpcSuccess | null): void => {
      if (!disposed && response && headlessActivationNeedsHostRenderer(response.result)) {
        showToast('Open Manta on the host to wake sleeping agents.', 3000)
      }
    }
    if (created !== '1') {
      // Why: hydrate host-owned tabs without pulling other paired clients (esp. desktop) into this worktree.
      void activateWorktree().then((response) =>
        reportActivationOutcome(response?.ok ? response : null)
      )
    } else {
      addTimer(() => {
        if (activeHandleRef.current) {
          return
        }
        void (async () => {
          const activationResponse = await activateWorktree()
          reportActivationOutcome(activationResponse?.ok ? activationResponse : null)
          if (disposed) {
            return
          }
          await fetchTerminals({ allowEmptyLoaded: true })
          addTimer(() => void fetchTerminals({ allowEmptyLoaded: true }), 750)
        })()
      }, 1800)
    }
    return () => {
      disposed = true
      for (const t of timers) {
        clearTimeout(t)
      }
    }
  }, [
    client,
    connState,
    created,
    fetchTerminals,
    isFloatingWorkspaceRoute,
    protocolVerified,
    showToast,
    worktreeId
  ])
}
