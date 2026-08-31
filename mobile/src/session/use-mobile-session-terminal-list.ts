import { useRef, useCallback } from 'react'
import type { RpcSuccess } from '../transport/types'
import { mergeTerminalListWithKnownRecords, terminalRecordsEqual } from './mobile-terminal-records'
import {
  createTerminalPrunePredicate,
  pruneTerminalKeyboardMetrics,
  resolveRetainedTerminalHandles
} from './mobile-terminal-prune-decision'
import type { Terminal } from './mobile-session-route-types'
import type { MobileSessionTerminalStreamDisplayModel } from './use-mobile-session-terminal-stream-display'

export function useMobileSessionTerminalList(scope: MobileSessionTerminalStreamDisplayModel) {
  const {
    worktreeId,
    client,
    setTerminals,
    terminalsRef,
    sessionTabsRef,
    pruneTerminalHandlesFromLiveInput,
    defaultTerminalHandlesToLiveInput,
    clearTerminalLiveInputDefault,
    setTerminalKeyboardMetrics,
    terminalRefs,
    terminalUnsubsRef,
    initializedHandlesRef,
    viewportResubscribeBudgetRef,
    activeHandleRef,
    showNativeChatRef,
    unsubscribeTerminal,
    subscribeToTerminal,
    nativeChatStream
  } = scope
  const lastKnownTerminalCountRef = useRef(0)
  const fetchTerminalsInFlightRef = useRef(false)

  const fetchTerminals = useCallback(
    async (opts: { allowEmptyLoaded?: boolean } = {}) => {
      if (!client) {
        return
      }
      if (fetchTerminalsInFlightRef.current) {
        return
      }
      fetchTerminalsInFlightRef.current = true
      const allowEmptyLoaded = opts.allowEmptyLoaded ?? true

      try {
        const response = await client.sendRequest('terminal.list', {
          worktree: `id:${worktreeId}`,
          includeVisualLayouts: false
        })
        if (response.ok) {
          const result = (response as RpcSuccess).result as { terminals: Terminal[] }
          if (result.terminals.length === 0 && !allowEmptyLoaded) {
            return
          }
          // Why: require two consecutive empties before trusting 0, so transient empty responses don't flash the UI empty.
          if (result.terminals.length === 0 && lastKnownTerminalCountRef.current > 0) {
            lastKnownTerminalCountRef.current = 0
            return
          }

          const liveHandles = new Set(result.terminals.map((terminal) => terminal.handle))
          const pruneContext = {
            liveHandles,
            showNativeChat: showNativeChatRef.current,
            activeHandle: activeHandleRef.current
          }
          // Why: terminal.list is the lifetime signal; lagging tab snapshots must not erase a user's buffered-mode opt-out.
          // Sweep against the retained set, not the raw list: a chat-covered handle
          // keeps its subscription across a graph reload, so erasing its live-input
          // preference on the same refresh is the erasure this guard exists to stop.
          pruneTerminalHandlesFromLiveInput(resolveRetainedTerminalHandles(pruneContext))
          defaultTerminalHandlesToLiveInput([...liveHandles])
          const shouldPrune = createTerminalPrunePredicate(pruneContext)
          for (const handle of Array.from(terminalUnsubsRef.current.keys())) {
            if (!shouldPrune(handle)) {
              continue
            }
            unsubscribeTerminal(handle)
            terminalRefs.current.delete(handle)
            initializedHandlesRef.current.delete(handle)
            viewportResubscribeBudgetRef.current.forget(handle)
            clearTerminalLiveInputDefault(handle)
          }
          setTerminalKeyboardMetrics((prev) => pruneTerminalKeyboardMetrics(prev, shouldPrune))
          // Why: a chat-covered handle the host reports again refills its rearm budget,
          // so an exhausted rearm can't lock the composer until leave-chat.
          nativeChatStream.notifyListedHandles(liveHandles)
          // Why: same absence-gated refill for the viewport-fit budget — a handle that
          // left the list and returned may converge now, so it earns fresh attempts.
          viewportResubscribeBudgetRef.current.notifyListedHandles(liveHandles)
          lastKnownTerminalCountRef.current = result.terminals.length
          // Why: dedupe duplicate handles (rename/split race) to avoid a React duplicate-key throw; keep first for tab-strip order.
          const seen = new Set<string>()
          const deduped = result.terminals.filter((t) => {
            if (seen.has(t.handle)) {
              return false
            }
            seen.add(t.handle)
            return true
          })

          const mergedTerminals = mergeTerminalListWithKnownRecords(
            deduped,
            terminalsRef.current,
            sessionTabsRef.current
          )
          setTerminals((prev) =>
            terminalRecordsEqual(prev, mergedTerminals) ? prev : mergedTerminals
          )
          terminalsRef.current = mergedTerminals

          // Session tabs are the UI authority; terminal.list only refreshes per-handle metadata for existing terminal surfaces.
        }
      } catch {
        // Failed to list terminals
      } finally {
        fetchTerminalsInFlightRef.current = false
      }
    },
    [
      client,
      worktreeId,
      clearTerminalLiveInputDefault,
      defaultTerminalHandlesToLiveInput,
      nativeChatStream,
      pruneTerminalHandlesFromLiveInput,
      subscribeToTerminal,
      unsubscribeTerminal
    ]
  )
  return {
    lastKnownTerminalCountRef,
    fetchTerminalsInFlightRef,
    fetchTerminals
  }
}

export type MobileSessionTerminalListModel = MobileSessionTerminalStreamDisplayModel &
  ReturnType<typeof useMobileSessionTerminalList>
