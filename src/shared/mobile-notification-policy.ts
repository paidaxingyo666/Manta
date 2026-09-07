import type { MobilePushAgentState, MobilePushFilter } from './mobile-push-contract'

export type MobileNotificationPolicyEvent = {
  source: string
  agentState?: string
  desktopAllowed?: boolean
}

export function mapPushAgentState(
  source: string,
  state: string | undefined
): MobilePushAgentState | null | undefined {
  if (source !== 'agent-task-complete') {
    return null
  }
  if (state === 'blocked' || state === 'waiting' || state === 'needs-input') {
    return 'needs-input'
  }
  return state === undefined || state === 'done' || state === 'finished' ? 'finished' : undefined
}

export function allowsMobileNotification(
  filter: MobilePushFilter,
  event: MobileNotificationPolicyEvent
): boolean {
  if (filter.followDesktop !== false && event.desktopAllowed === false) {
    return false
  }
  if (!filter.sources.some((source) => source === event.source)) {
    return false
  }
  const state = mapPushAgentState(event.source, event.agentState)
  return state !== undefined && (state === null || filter.agentStates.includes(state))
}
