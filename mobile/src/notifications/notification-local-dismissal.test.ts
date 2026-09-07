import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import {
  setScheduledNotificationsMaxForTests,
  subscribeToDesktopNotifications
} from './mobile-notifications'
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

  function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((next) => {
      resolve = next
    })
    return { promise, resolve }
  }

  it('dismisses a notification when dismiss arrives while scheduling is pending', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    let resolveSchedule!: (identifier: string) => void
    vi.mocked(Notifications.scheduleNotificationAsync).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveSchedule = resolve
        })
    )
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

    subscribeToDesktopNotifications(client, 'host-dismiss-race')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      notificationId: 'agent:pending'
    })
    await flushAsync()
    onEvent?.({ type: 'dismiss', notificationId: 'agent:pending' })
    resolveSchedule('scheduled-pending')
    await flushAsync()

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('scheduled-pending')
  })

  it('does not carry a failed pending dismiss into a future schedule', async () => {
    const secondEnabled = makeDeferred<boolean>()
    vi.mocked(loadPushNotificationsEnabled)
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(secondEnabled.promise)
      .mockResolvedValueOnce(true)
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

    subscribeToDesktopNotifications(client, 'host-dismiss-failed-replacement')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done',
      body: 'Finished.',
      notificationId: 'agent:stale-dismiss'
    })
    await flushAsync()
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done again',
      body: 'Finished again.',
      notificationId: 'agent:stale-dismiss'
    })
    await flushAsync()
    onEvent?.({ type: 'dismiss', notificationId: 'agent:stale-dismiss' })
    secondEnabled.resolve(false)
    await flushAsync()

    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Done later',
      body: 'Finished later.',
      notificationId: 'agent:stale-dismiss'
    })
    await flushAsync()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2)
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1)
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('scheduled-1')
  })

  it('treats unknown dismiss events as no-ops', async () => {
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

    subscribeToDesktopNotifications(client, 'host-unknown')
    onEvent?.({ type: 'dismiss', notificationId: 'agent:missing' })
    await flushAsync()

    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled()
  })

  // Why: notificationId is unique per completion, so the map grew unbounded when
  // the desktop never sent a dismiss (the remote-mobile case). It is now capped.
  it('evicts the oldest scheduled entry once the cap is exceeded', async () => {
    setScheduledNotificationsMaxForTests(1)
    try {
      vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
      vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
        status: 'granted',
        canAskAgain: true
      } as never)
      vi.mocked(Notifications.scheduleNotificationAsync)
        .mockResolvedValueOnce('scheduled-old')
        .mockResolvedValueOnce('scheduled-new')
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
        title: 't',
        body: 'b',
        notificationId: 'agent:old'
      })
      await flushAsync()
      onEvent?.({
        type: 'notification',
        source: 'agent-task-complete',
        title: 't',
        body: 'b',
        notificationId: 'agent:new'
      })
      await flushAsync()

      // The older entry was evicted by the cap: dismissing it is a no-op...
      onEvent?.({ type: 'dismiss', notificationId: 'agent:old' })
      await flushAsync()
      expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith('scheduled-old')

      // ...while the most-recent entry is retained and still dismissable.
      onEvent?.({ type: 'dismiss', notificationId: 'agent:new' })
      await flushAsync()
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('scheduled-new')
    } finally {
      setScheduledNotificationsMaxForTests()
    }
  })
})
