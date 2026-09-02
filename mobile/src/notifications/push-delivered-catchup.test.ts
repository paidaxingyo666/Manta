/**
 * A push shown to a closed app must not be notified again on the next open.
 *
 * The catch-up watermark advances only when a notification arrives over a live
 * socket, so everything APNs delivered while the app was closed left it where it
 * was — and the next connect asked the desktop for that whole span again and
 * re-notified all of it. The notification service extension records how far each
 * push carried the counter; these pin that the session folds it in.
 *
 * Only the fold is testable here. Whether the extension actually wrote the value
 * is a device question: it runs in its own process, only for a real delivery.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptNotificationEpoch,
  getHostNotificationSession,
  resetHostNotificationSessionsForTests,
  seedWatermarkFromStorage
} from './notification-reconnect-catchup'
import { readDeliveredSeq } from '../../modules/push-delivered-seq'
import AsyncStorage from '@react-native-async-storage/async-storage'

vi.mock('../../modules/push-delivered-seq', () => ({
  readDeliveredSeq: vi.fn(() => null)
}))

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => void store.set(key, value)),
      removeItem: vi.fn(async (key: string) => void store.delete(key)),
      __store: store
    }
  }
})

const HOST = 'host-1'
const EPOCH = 'epoch-a'

function storeKey(hostId: string): string {
  return `manta:mobileNotificationsWatermark:${hostId}`
}

describe('folding what a push already delivered', () => {
  beforeEach(() => {
    resetHostNotificationSessionsForTests()
    ;(AsyncStorage as unknown as { __store: Map<string, string> }).__store.clear()
    vi.mocked(readDeliveredSeq).mockReturnValue(null)
  })

  it('skips past a push the extension recorded for this counter', async () => {
    vi.mocked(readDeliveredSeq).mockReturnValue(57)
    const session = getHostNotificationSession(HOST)

    adoptNotificationEpoch(session, HOST, EPOCH)

    expect(readDeliveredSeq).toHaveBeenCalledWith(EPOCH)
    expect(session.lastDeliveredSeq).toBe(57)
  })

  /**
   * A sequence only means something inside one counter lifetime. Folding one
   * from a dead counter would cut the new counter's own 1..N — the failure the
   * epoch reset exists to prevent, reached through the push path instead.
   */
  it('ignores a mark recorded under a different counter', async () => {
    vi.mocked(readDeliveredSeq).mockImplementation((epoch) => (epoch === 'epoch-old' ? 57 : null))
    const session = getHostNotificationSession(HOST)

    adoptNotificationEpoch(session, HOST, EPOCH)

    expect(session.lastDeliveredSeq).toBe(0)
  })

  it('never walks the watermark backwards', async () => {
    vi.mocked(readDeliveredSeq).mockReturnValue(3)
    await AsyncStorage.setItem(storeKey(HOST), JSON.stringify({ seq: 40, epoch: EPOCH }))
    const session = getHostNotificationSession(HOST)

    seedWatermarkFromStorage(session, HOST)
    await session.watermarkSeeded

    expect(session.lastDeliveredSeq).toBe(40)
  })

  it('folds the mark in on the stored-watermark path too', async () => {
    vi.mocked(readDeliveredSeq).mockReturnValue(88)
    await AsyncStorage.setItem(storeKey(HOST), JSON.stringify({ seq: 40, epoch: EPOCH }))
    const session = getHostNotificationSession(HOST)

    seedWatermarkFromStorage(session, HOST)
    await session.watermarkSeeded

    expect(session.lastDeliveredSeq).toBe(88)
  })

  // A build without the module learns nothing and must behave exactly as before,
  // which over-notifies rather than skipping something nobody saw.
  it('leaves the watermark alone when the module is absent', async () => {
    vi.mocked(readDeliveredSeq).mockReturnValue(null)
    await AsyncStorage.setItem(storeKey(HOST), JSON.stringify({ seq: 40, epoch: EPOCH }))
    const session = getHostNotificationSession(HOST)

    seedWatermarkFromStorage(session, HOST)
    await session.watermarkSeeded

    expect(session.lastDeliveredSeq).toBe(40)
  })
})
