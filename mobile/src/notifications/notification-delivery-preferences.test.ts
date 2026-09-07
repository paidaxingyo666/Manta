import { beforeEach, expect, it, vi } from 'vitest'
import { AppState } from 'react-native'
import {
  DEFAULT_NOTIFICATION_DELIVERY,
  loadNotificationDeliveryPreferences,
  notificationPreferencesFilter,
  saveNotificationDeliveryPreferences
} from './notification-delivery-preferences'
import {
  allowsLocalNotification,
  setNotificationViewingWorkspace
} from './notification-viewing-policy'
import { allowsMobileNotification } from '../../../src/shared/mobile-notification-policy'

const storage = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value)
    })
  }
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'background' } }))
beforeEach(() => {
  storage.clear()
  setNotificationViewingWorkspace(null)
  AppState.currentState = 'background'
})

it('defaults to following desktop and persists independent event preferences', async () => {
  expect(await loadNotificationDeliveryPreferences()).toEqual(DEFAULT_NOTIFICATION_DELIVERY)
  const value = {
    ...DEFAULT_NOTIFICATION_DELIVERY,
    followDesktop: false,
    terminalBell: false,
    sound: false
  }
  await saveNotificationDeliveryPreferences(value)
  expect(await loadNotificationDeliveryPreferences()).toEqual(value)
  expect(notificationPreferencesFilter(value)).toMatchObject({
    followDesktop: false,
    sound: false,
    sources: ['agent-task-complete', 'plugin']
  })
})

it('preserves explicitly narrowed filters from before the new settings screen', async () => {
  storage.set('manta:remotePushAgentStates', '["needs-input"]')
  expect(await loadNotificationDeliveryPreferences()).toMatchObject({
    followDesktop: false,
    needsInput: true,
    taskFinished: false
  })
})

it.each(['agent-task-complete', 'terminal-bell', 'plugin'])(
  'uses identical type filtering for socket/replay and background push: %s',
  async (source) => {
    for (const followDesktop of [true, false]) {
      const value = {
        ...DEFAULT_NOTIFICATION_DELIVERY,
        followDesktop,
        terminalBell: false,
        taskFinished: false
      }
      await saveNotificationDeliveryPreferences(value)
      for (const desktopAllowed of [true, false]) {
        const event = { source, desktopAllowed, agentState: 'done' }
        expect(await allowsLocalNotification(event, 'host')).toBe(
          allowsMobileNotification(notificationPreferencesFilter(value), event)
        )
      }
    }
  }
)

it('suppresses only the workspace being viewed on this phone, and never while backgrounded', async () => {
  const event = { source: 'terminal-bell', worktreeId: 'folder-id' }
  setNotificationViewingWorkspace({ hostId: 'ssh-host', worktreeId: 'folder-id' })
  AppState.currentState = 'active'
  expect(await allowsLocalNotification(event, 'ssh-host')).toBe(false)
  expect(await allowsLocalNotification(event, 'another-host')).toBe(true)
  expect(await allowsLocalNotification({ ...event, worktreeId: 'other' }, 'ssh-host')).toBe(true)
  AppState.currentState = 'background'
  expect(await allowsLocalNotification(event, 'ssh-host')).toBe(true)
})
