import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  MOBILE_PUSH_AGENT_STATES,
  MOBILE_PUSH_SOURCES,
  type MobilePushFilter
} from '../../../src/shared/mobile-push-contract'

const KEY = 'manta:notificationDeliveryPreferences'
export type NotificationDeliveryPreferences = {
  followDesktop: boolean
  taskFinished: boolean
  needsInput: boolean
  terminalBell: boolean
  plugin: boolean
  sound: boolean
  suppressWhileViewing: boolean
}

export const DEFAULT_NOTIFICATION_DELIVERY: NotificationDeliveryPreferences = {
  followDesktop: true,
  taskFinished: true,
  needsInput: true,
  terminalBell: true,
  plugin: true,
  sound: true,
  suppressWhileViewing: true
}

export async function loadNotificationDeliveryPreferences(): Promise<NotificationDeliveryPreferences> {
  const raw = await AsyncStorage.getItem(KEY)
  if (!raw) {
    // Preserve an existing explicit background filter when upgrading.
    const legacy = await AsyncStorage.getItem('manta:remotePushAgentStates')
    if (legacy) {
      const states: unknown = JSON.parse(legacy)
      if (Array.isArray(states)) {
        return {
          ...DEFAULT_NOTIFICATION_DELIVERY,
          followDesktop: false,
          taskFinished: states.includes('finished'),
          needsInput: states.includes('needs-input')
        }
      }
    }
    return { ...DEFAULT_NOTIFICATION_DELIVERY }
  }
  const stored = JSON.parse(raw) as Record<string, unknown>
  const result = { ...DEFAULT_NOTIFICATION_DELIVERY }
  for (const key of Object.keys(result) as (keyof NotificationDeliveryPreferences)[]) {
    if (typeof stored?.[key] === 'boolean') {
      result[key] = stored[key]
    }
  }
  return result
}

export async function saveNotificationDeliveryPreferences(
  value: NotificationDeliveryPreferences
): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(value))
}

export function notificationPreferencesFilter(
  value: NotificationDeliveryPreferences
): MobilePushFilter {
  if (value.followDesktop) {
    return {
      sound: value.sound,
      followDesktop: true,
      sources: MOBILE_PUSH_SOURCES,
      agentStates: MOBILE_PUSH_AGENT_STATES
    }
  }
  return {
    followDesktop: false,
    sound: value.sound,
    sources: MOBILE_PUSH_SOURCES.filter((source) =>
      source === 'terminal-bell'
        ? value.terminalBell
        : source === 'plugin'
          ? value.plugin
          : value.needsInput || value.taskFinished
    ),
    agentStates: MOBILE_PUSH_AGENT_STATES.filter((state) =>
      state === 'needs-input' ? value.needsInput : value.taskFinished
    )
  }
}
