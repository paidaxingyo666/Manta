import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { showLocalNotification } from './local-notification-scheduling'
import { Platform } from 'react-native'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(async () => []),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  Platform: { OS: 'ios', Version: 18 }
}))

// The reconnect catch-up reads the tray to learn which pushes the OS already showed,
// and mapping those to this host needs the catalog, whose real module pulls the
// native keychain. No push is presented in these tests, so an empty catalog is enough.
vi.mock('../transport/host-store', () => ({ loadHostCatalog: vi.fn(async () => []) }))

// Why: mobile-notifications now persists the catch-up watermark to
// AsyncStorage. The package isn't resolvable in the node test env (other
// mobile tests mock it the same way), so we provide a no-op mock.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined)
  }
}))

vi.mock('../storage/preferences', () => ({
  loadRemotePushEnabled: vi.fn(async () => false),
  loadPushNotificationsEnabled: vi.fn()
}))

beforeEach(() => {
  Object.assign(Platform, { OS: 'ios', Version: 18 })
  // Why (#8591): the reconnect watermark/seen-set now live per host at module
  // scope so they survive the app's unsubscribe-on-disconnect. Reset between
  // tests so each case starts from a genuine cold open.
  resetHostNotificationSessionsForTests()
})

describe('subscribeToDesktopNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Why the macrotask and not N microtask ticks (#8591): deliveries now run through
  // the per-host serialization queue, so a delivery is several more `await` hops deep
  // than it used to be and a fixed tick count silently under-drains. Yielding to the
  // macrotask queue drains whatever depth the chain happens to have.
  function flushAsync(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }

  it('drops the local stream when disposed before the desktop returns ready', () => {
    const unsubscribeStream = vi.fn()
    const client = {
      subscribe: vi.fn(() => unsubscribeStream),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    const unsubscribe = subscribeToDesktopNotifications(client, 'host-1')
    unsubscribe()

    expect(unsubscribeStream).toHaveBeenCalledTimes(1)
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it('stores scheduled notification identifiers, replaces duplicates, and dismisses by id', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync)
      .mockResolvedValueOnce('scheduled-1')
      .mockResolvedValueOnce('scheduled-2')
    vi.mocked(Notifications.dismissNotificationAsync).mockResolvedValue(undefined)
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    subscribeToDesktopNotifications(client, 'host-1')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      worktreeId: 'repo::/tmp/worktree',
      notificationId: 'agent:one'
    })
    await flushAsync()
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done again',
      body: 'Finished again.',
      notificationId: 'agent:one'
    })
    await flushAsync()
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2)
    onEvent?.({ type: 'dismiss', notificationId: 'agent:one' })
    await flushAsync()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2)
    expect(Notifications.scheduleNotificationAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: expect.objectContaining({
          data: expect.objectContaining({
            hostId: 'host-1',
            notificationId: 'agent:one',
            worktreeId: 'repo::/tmp/worktree'
          })
        })
      })
    )
    expect(Notifications.dismissNotificationAsync).toHaveBeenNthCalledWith(1, 'scheduled-1')
    expect(Notifications.dismissNotificationAsync).toHaveBeenNthCalledWith(2, 'scheduled-2')
  })

  it('dedupes concurrent notification events with the same desktop notification id', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('scheduled-1')
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    subscribeToDesktopNotifications(client, 'host-concurrent')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      notificationId: 'agent:concurrent'
    })
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      notificationId: 'agent:concurrent'
    })
    await flushAsync()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })
})

it('filters before cooldown and retains the existing banner when a later burst is suppressed', async () => {
  vi.clearAllMocks()
  vi.mocked(AsyncStorage.getItem).mockResolvedValue(
    JSON.stringify({ followDesktop: false, terminalBell: false })
  )
  vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
  vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    status: 'granted',
    canAskAgain: true
  } as never)
  vi.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('cooldown-banner')
  const event = {
    type: 'notification' as const,
    title: 'Done',
    body: '',
    worktreeId: 'folder',
    notificationId: 'cooldown-event',
    emittedAt: 10000
  }
  await showLocalNotification({ ...event, source: 'terminal-bell' }, 'cooldown-host')
  await showLocalNotification(
    { ...event, source: 'agent-task-complete', agentState: 'done', emittedAt: 10250 },
    'cooldown-host'
  )
  await showLocalNotification(
    { ...event, source: 'agent-task-complete', agentState: 'done', emittedAt: 10500 },
    'cooldown-host'
  )
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled()
})
