import { beforeEach, expect, it, vi } from 'vitest'
import { AppState } from 'react-native'
import { waitForSocketPushHandoff } from './socket-push-delivery-handoff'
import { readPresentedPushSeenKeys } from './push-tray-seen-seed'
import { loadRemotePushEnabled } from '../storage/preferences'
import { seenKeyForEvent } from './notification-reconnect-catchup'

let active: ((state: string) => void) | undefined
const remove = vi.fn()
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'background',
    addEventListener: vi.fn((_event, callback) => {
      active = callback
      return { remove }
    })
  }
}))
vi.mock('../storage/preferences', () => ({
  loadRemotePushEnabled: vi.fn(async () => true),
  loadRemotePushHostRegistrations: vi.fn(async () => ({ registeredHostIds: ['host'] }))
}))
vi.mock('./push-tray-seen-seed', () => ({ readPresentedPushSeenKeys: vi.fn(async () => []) }))
const event = {
  type: 'notification' as const,
  source: 'agent-task-complete' as const,
  title: 'Done',
  body: '',
  notificationId: 'done',
  notificationSeq: 1,
  notificationEpoch: 'epoch'
}
beforeEach(() => {
  vi.clearAllMocks()
  active = undefined
  AppState.currentState = 'background'
})

it('waits for foreground and suppresses a live socket event already delivered by APNs', async () => {
  vi.mocked(readPresentedPushSeenKeys).mockResolvedValue([
    { key: seenKeyForEvent(event)!, epoch: 'epoch' }
  ])
  const delivery = waitForSocketPushHandoff(event, 'host', new AbortController().signal)
  await vi.waitFor(() => expect(active).toBeDefined())
  expect(readPresentedPushSeenKeys).not.toHaveBeenCalled()
  AppState.currentState = 'active'
  active?.('active')
  expect(await delivery).toBe(false)
  expect(remove).toHaveBeenCalledOnce()
})

it('falls back to local delivery on foreground when no provider notification arrived', async () => {
  vi.mocked(readPresentedPushSeenKeys).mockResolvedValue([])
  const delivery = waitForSocketPushHandoff(event, 'host', new AbortController().signal)
  await vi.waitFor(() => expect(active).toBeDefined())
  AppState.currentState = 'active'
  active?.('active')
  expect(await delivery).toBe(true)
})

it('releases the background wait when the subscription is disposed', async () => {
  const controller = new AbortController()
  const delivery = waitForSocketPushHandoff(event, 'host', controller.signal)
  await vi.waitFor(() => expect(active).toBeDefined())
  controller.abort()
  expect(await delivery).toBe(false)
  expect(remove).toHaveBeenCalledOnce()
})

it('keeps local background delivery when remote push is disabled', async () => {
  vi.mocked(loadRemotePushEnabled).mockResolvedValueOnce(false)
  expect(await waitForSocketPushHandoff(event, 'host', new AbortController().signal)).toBe(true)
  expect(active).toBeUndefined()
})

it('leaves hosts without a registered push token on local delivery', async () => {
  expect(
    await waitForSocketPushHandoff(event, 'unregistered-host', new AbortController().signal)
  ).toBe(true)
  expect(active).toBeUndefined()
})
