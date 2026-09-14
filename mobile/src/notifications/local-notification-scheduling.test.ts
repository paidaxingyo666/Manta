import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { buildLocalNotificationData, showLocalNotification } from './local-notification-scheduling'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 18 }
}))

vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(Platform, { OS: 'ios', Version: 18 })
})

describe('buildLocalNotificationData', () => {
  it('includes the host id in locally scheduled notification data', () => {
    expect(
      buildLocalNotificationData(
        {
          source: 'agent-task-complete',
          worktreeId: 'repo::/Users/me/manta/workspaces/feature',
          notificationId: 'agent:one'
        },
        'host-1'
      )
    ).toEqual({
      source: 'agent-task-complete',
      hostId: 'host-1',
      worktreeId: 'repo::/Users/me/manta/workspaces/feature',
      notificationId: 'agent:one'
    })
  })
})

describe('showLocalNotification', () => {
  it('posts Android notifications on the channel the boot path creates', async () => {
    Object.assign(Platform, { OS: 'android', Version: 34 })
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('sched-1')

    await showLocalNotification(
      { type: 'notification', source: 'terminal-bell', title: 'Bell', body: 'Done' },
      'host-1'
    )

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: expect.objectContaining({ channelId: 'manta-desktop' }),
      trigger: null
    })
  })
})
