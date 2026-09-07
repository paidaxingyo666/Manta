import { AppState } from 'react-native'
import {
  allowsMobileNotification,
  type MobileNotificationPolicyEvent
} from '../../../src/shared/mobile-notification-policy'
import {
  loadNotificationDeliveryPreferences,
  notificationPreferencesFilter
} from './notification-delivery-preferences'

let viewing: { hostId: string; worktreeId: string } | null = null
export function setNotificationViewingWorkspace(value: typeof viewing): void {
  viewing = value
}

export async function allowsLocalNotification(
  event: MobileNotificationPolicyEvent & { worktreeId?: string },
  hostId: string
): Promise<boolean> {
  const preferences = await loadNotificationDeliveryPreferences()
  if (!allowsMobileNotification(notificationPreferencesFilter(preferences), event)) {
    return false
  }
  return !(
    preferences.suppressWhileViewing &&
    AppState.currentState === 'active' &&
    viewing?.hostId === hostId &&
    viewing.worktreeId === event.worktreeId
  )
}
