import { AppState } from 'react-native'
import { loadRemotePushEnabled, loadRemotePushHostRegistrations } from '../storage/preferences'
import { readPresentedPushSeenKeys } from './push-tray-seen-seed'
import { seenKeyForEvent } from './notification-reconnect-catchup'
import type { NotificationEvent } from './local-notification-scheduling'

function waitUntilActive(signal: AbortSignal): Promise<void> {
  if (AppState.currentState === 'active' || signal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const finish = () => {
      subscription.remove()
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        finish()
      }
    })
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted || AppState.currentState === 'active') {
      finish()
    }
  })
}

export async function waitForSocketPushHandoff(
  event: NotificationEvent,
  hostId: string,
  signal: AbortSignal
): Promise<boolean> {
  if (!(await loadRemotePushEnabled())) {
    return true
  }
  const registrations = await loadRemotePushHostRegistrations()
  if (!registrations.registeredHostIds.includes(hostId)) {
    return true
  }
  // iOS can keep the socket alive while backgrounded; let APNs own that interval.
  await waitUntilActive(signal)
  if (signal.aborted) {
    return false
  }
  const key = seenKeyForEvent(event)
  const presented = await readPresentedPushSeenKeys(hostId)
  return !presented.some((push) => push.key === key && push.epoch === event.notificationEpoch)
}
