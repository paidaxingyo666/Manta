import { useCallback } from 'react'
import {
  getStructuredAgentSessionLaunchLifecycle,
  retryStructuredAgentSessionLaunch,
  useStructuredAgentSessionLaunchFailureReason,
  useStructuredAgentSessionLaunchLifecycle
} from '@/lib/structured-agent-session-launch'

export function useNativeChatProvisionalLaunch(
  worktreeId: string | null | undefined,
  sessionId: string
) {
  const lifecycle = useStructuredAgentSessionLaunchLifecycle(worktreeId ?? '', sessionId)
  const failureReason = useStructuredAgentSessionLaunchFailureReason(worktreeId ?? '', sessionId)
  const retry = useCallback(() => {
    if (worktreeId) {
      retryStructuredAgentSessionLaunch(worktreeId, sessionId)
    }
  }, [sessionId, worktreeId])
  // A send into a start that never published relaunches it; the queued message goes out on publish.
  const sendThroughRelaunch = useCallback(
    (send: () => boolean): boolean => {
      const accepted = send()
      if (
        accepted &&
        worktreeId &&
        getStructuredAgentSessionLaunchLifecycle(worktreeId, sessionId) === 'failed'
      ) {
        retryStructuredAgentSessionLaunch(worktreeId, sessionId)
      }
      return accepted
    },
    [sessionId, worktreeId]
  )
  return {
    lifecycle,
    failureReason,
    retry,
    sendThroughRelaunch,
    transportEnabled: lifecycle === null || lifecycle === 'published'
  }
}
