import { Platform } from 'react-native'
import { translate } from '../i18n/i18n'
import { classifyConnection, verdictDisplayLabel } from '../transport/connection-health'
import { computeActiveTerminalKeyboardLift } from '../terminal/terminal-keyboard-avoidance-lift'
import { useInitialSessionTerminalAutoCreate } from './use-initial-session-terminal-autocreate'
import { MOBILE_SESSION_STATUS_LABELS } from './mobile-session-route-helpers'
import type { MobileSessionBulkCloseModel } from './use-mobile-session-bulk-close'

export function useMobileSessionPresentation(scope: MobileSessionBulkCloseModel) {
  const {
    created,
    worktreeId,
    router,
    insets,
    connState,
    client,
    reconnectAttempts,
    lastConnectedAt,
    terminalsLoaded,
    activeHandle,
    creating,
    creatingBrowser,
    creatingMarkdown,
    keyboardHeight,
    terminalKeyboardMetrics,
    toastOpacityRef,
    hostEndpoint,
    initialSessionAutoCreateRef,
    terminalFrameHeightRef,
    handleCreateTerminal,
    visibleTabs
  } = scope
  const showLoadingState = connState === 'connected' && !terminalsLoaded && visibleTabs.length === 0
  const showEmptyState =
    connState === 'connected' && terminalsLoaded && visibleTabs.length === 0 && !activeHandle

  // Why: a newly created workspace can hydrate with zero tabs before its first terminal exists.
  useInitialSessionTerminalAutoCreate({
    client,
    newlyCreatedWorkspace: created === '1',
    connState,
    terminalsLoaded,
    visibleTabCount: visibleTabs.length,
    activeHandle,
    createInFlight: creating || creatingBrowser || creatingMarkdown,
    stateRef: initialSessionAutoCreateRef,
    worktreeId,
    consumeCreationRoute: () => router.setParams({ created: undefined }),
    createTerminal: () => void handleCreateTerminal()
  })

  // Why: reconnect trickles to 90s at its give-up cap; surface tap-to-retry so recovery needn't wait it out (issue #5049).
  const connectionVerdict = classifyConnection({
    state: connState,
    reconnectAttempts,
    lastConnectedAt,
    endpoint: hostEndpoint
  })
  const showConnectionRetry =
    connectionVerdict.kind === 'warning' || connectionVerdict.kind === 'unreachable'

  const terminalSummary =
    connState === 'connected'
      ? showLoadingState
        ? translate('m.worktreeId.bc570e2e5a', 'Loading tabs')
        : visibleTabs.length === 1
          ? translate('m.worktreeId.291c4edd48', '1 tab')
          : translate('m.worktreeId.fb82b8a66c', '{{value0}} tabs', {
              value0: visibleTabs.length
            })
      : showConnectionRetry
        ? translate('m.worktreeId.4ba45b196f', '{{value0}} — tap to retry', {
            value0: verdictDisplayLabel(connectionVerdict)
          })
        : MOBILE_SESSION_STATUS_LABELS[connState]

  // Why: iOS keyboard height includes the home-indicator inset; Android IME height does not.
  const keyboardLift =
    keyboardHeight > 0
      ? Platform.OS === 'ios'
        ? Math.max(0, keyboardHeight - insets.bottom)
        : keyboardHeight
      : 0
  const activeTerminalKeyboardLift = computeActiveTerminalKeyboardLift({
    keyboardLift,
    metrics: activeHandle ? terminalKeyboardMetrics.get(activeHandle) : undefined,
    terminalFrameHeight: terminalFrameHeightRef.current
  })
  const toastAnimatedStyle = {
    opacity: toastOpacityRef.current,
    transform: [{ translateY: -keyboardLift }]
  }
  return {
    showLoadingState,
    showEmptyState,
    connectionVerdict,
    showConnectionRetry,
    terminalSummary,
    keyboardLift,
    activeTerminalKeyboardLift,
    toastAnimatedStyle
  }
}

export type MobileSessionPresentationModel = MobileSessionBulkCloseModel &
  ReturnType<typeof useMobileSessionPresentation>
