import { useEffect, useRef, useCallback } from 'react'
import { startRuntimeCapabilityProbe } from '../transport/runtime-capability-probe'
import { supportsMobileQuickCommands } from '../terminal/quick-commands'
import { MOBILE_AI_VAULT_CAPABILITY } from '../agent-history/agent-history-capability'
import { TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import { runAcceptedMobileSessionTabsEffects } from './mobile-session-tabs-accepted-effects'
import type { SessionTabsStreamSource } from './mobile-session-tabs-stream-health'
import { useMobileSessionTabsFetchReporting } from './use-mobile-session-tabs-fetch-reporting'
import { useMobileSessionTabsReconciliation } from './use-mobile-session-tabs-reconciliation'
import type { MobileSessionTab, SessionTabsResult } from './mobile-session-route-types'
import type { MobileSessionMarkdownActionsModel } from './use-mobile-session-markdown-actions'

export function useMobileSessionTabReconciliation(scope: MobileSessionMarkdownActionsModel) {
  const {
    worktreeId,
    client,
    connState,
    appliedSessionTabsRevisionRef,
    closedTabTombstonesRef,
    setMarkdownDocs,
    setShowQuickCommands,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    terminalDiagnosticsRef,
    pendingBrowserFocusPageIdRef,
    switchSessionTabRef,
    setBrowserScreencastSupported,
    setAgentSessionHistorySupported,
    setQuickCommandsSupported,
    nativeChatStream,
    fetchTerminals,
    applySessionTabs
  } = scope
  const consumeAcceptedSessionTabs = useCallback(
    (
      _result: SessionTabsResult,
      effectiveTabs: readonly MobileSessionTab[],
      source: SessionTabsStreamSource
    ): void => {
      runAcceptedMobileSessionTabsEffects<MobileSessionTab>({
        effectiveTabs,
        source,
        getPendingBrowserPageId: () => pendingBrowserFocusPageIdRef.current,
        clearPendingBrowserPageId: (pageId) => {
          if (pendingBrowserFocusPageIdRef.current === pageId) {
            pendingBrowserFocusPageIdRef.current = null
          }
        },
        activateBrowserTab: (tab) => switchSessionTabRef.current?.(tab),
        markActiveMarkdownStale: (tabId) => {
          setMarkdownDocs((prev) => {
            const current = prev.get(tabId)
            if (current?.status !== 'ready' || current.isDirty) {
              return prev
            }
            return new Map(prev).set(tabId, { ...current, stale: true })
          })
        }
      })
    },
    []
  )
  const hasSessionTabsRecoveryNeed = useCallback(
    () =>
      closedTabTombstonesRef.current.size > 0 ||
      pendingBrowserFocusPageIdRef.current !== null ||
      // Why: a chat-covered handle that ran out of rearms and left `terminal.list`
      // was reminted by a desktop graph reload. Only a fresh tab snapshot carries
      // the replacement handle, so force one instead of holding the composer locked.
      nativeChatStream.hasTabsRecoveryNeed(),
    [nativeChatStream]
  )
  const getSessionTabsApplicationRevision = useCallback(
    () => appliedSessionTabsRevisionRef.current,
    []
  )
  const sessionTabsFetchReporting = useMobileSessionTabsFetchReporting<SessionTabsResult>({
    worktreeId,
    diagnosticsRef: terminalDiagnosticsRef
  })
  const { fetchSessionTabs, ensureSessionTabs, fetchPendingBrowserSessionTabs } =
    useMobileSessionTabsReconciliation<SessionTabsResult, MobileSessionTab>({
      client,
      connState,
      worktreeId,
      applySessionTabs,
      consumeAcceptedSessionTabs,
      fetchTerminals,
      hasRecoveryNeed: hasSessionTabsRecoveryNeed,
      getApplicationRevision: getSessionTabsApplicationRevision,
      ...sessionTabsFetchReporting
    })

  useEffect(() => {
    if (connState === 'connected') {
      return
    }
    for (const queued of terminalGestureInputQueuesRef.current.values()) {
      if (queued.timer) {
        clearTimeout(queued.timer)
      }
    }
    terminalGestureInputQueuesRef.current.clear()
    terminalGestureInputInFlightRef.current.clear()
  }, [connState])

  const hostQueryReplyInputSupportedRef = useRef(false)

  useEffect(() => {
    if (!client || connState !== 'connected') {
      setBrowserScreencastSupported(null)
      setAgentSessionHistorySupported(null)
      setQuickCommandsSupported(null)
      setShowQuickCommands(false)
      hostQueryReplyInputSupportedRef.current = false
      return
    }
    // Why: a client swap can keep the route connected while moving to an older
    // host; clear the prior capability before exposing host-specific actions.
    setBrowserScreencastSupported(null)
    setAgentSessionHistorySupported(null)
    setQuickCommandsSupported(null)
    setShowQuickCommands(false)
    hostQueryReplyInputSupportedRef.current = false
    // Why: the probe retries — a relay→direct cutover or request timeout rejects
    // status.get without changing connState, which used to latch these hidden.
    return startRuntimeCapabilityProbe(client, (capabilities) => {
      setBrowserScreencastSupported(capabilities.includes('browser.screencast.v1'))
      setAgentSessionHistorySupported(capabilities.includes(MOBILE_AI_VAULT_CAPABILITY))
      setQuickCommandsSupported(supportsMobileQuickCommands(capabilities))
      // Why: hosts without this capability strip inputKind from terminal.send,
      // so a forwarded xterm reply would become floor-stealing shell input.
      hostQueryReplyInputSupportedRef.current = capabilities.includes(
        TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY
      )
    })
  }, [client, connState])
  return {
    consumeAcceptedSessionTabs,
    hasSessionTabsRecoveryNeed,
    getSessionTabsApplicationRevision,
    sessionTabsFetchReporting,
    fetchSessionTabs,
    ensureSessionTabs,
    fetchPendingBrowserSessionTabs,
    hostQueryReplyInputSupportedRef
  }
}

export type MobileSessionTabReconciliationModel = MobileSessionMarkdownActionsModel &
  ReturnType<typeof useMobileSessionTabReconciliation>
