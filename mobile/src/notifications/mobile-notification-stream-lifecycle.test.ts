import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { reportPushToken } from './push-token-reporting'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'
import { RpcClientStreamRegistry } from '../transport/rpc-client-stream-registry'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'

vi.mock('./desktop-notification-channel', () => ({
  ensureDesktopNotificationChannel: vi.fn(async () => {})
}))
vi.mock('./push-token-reporting', () => ({ reportPushToken: vi.fn(async () => ({})) }))
vi.mock('./notification-permissions', () => ({}))
vi.mock('./local-notification-scheduling', () => ({
  showLocalNotification: vi.fn(async () => {}),
  dismissLocalNotification: vi.fn(async () => {}),
  setScheduledNotificationsMaxForTests: vi.fn()
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) }
}))
vi.mock('../../modules/push-delivered-seq', () => ({ readDeliveredSeq: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  resetHostNotificationSessionsForTests()
})

type SentFrame = { id: string; method: string; params: unknown }

/** The registry sends through an `unknown` port, so name the shape the assertions read. */
function readSentFrame(request: unknown): SentFrame {
  if (
    typeof request !== 'object' ||
    request === null ||
    !('id' in request) ||
    typeof request.id !== 'string' ||
    !('method' in request) ||
    typeof request.method !== 'string'
  ) {
    throw new Error('The stream registry sent a frame without a string id and method')
  }
  return {
    id: request.id,
    method: request.method,
    params: 'params' in request ? request.params : undefined
  }
}

/** The real stream registry, so dispose-before-ready is answered by the transport, not by a fake. */
function registryClient() {
  const sent: SentFrame[] = []
  const requests: { method: string; params: unknown }[] = []
  let id = 0
  const registry = new RpcClientStreamRegistry({
    nextId: () => `rpc-${++id}`,
    deviceToken: 'device-token',
    getState: () => 'connected',
    sendEncrypted: (request) => {
      sent.push(readSentFrame(request))
      return true
    }
  })
  const client: RpcClient = {
    sendRequest: async (method, params) => {
      requests.push({ method, params })
      return { id: 'reply-1', ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } }
    },
    subscribe: (method, params, onData, options) =>
      registry.subscribe(method, params, onData, options),
    updateTerminalSubscriptionViewport: () => {},
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    onStateChange: () => () => {},
    notifyForeground: () => {},
    close: () => {}
  }
  return { registry, sent, requests, client }
}

function readyReply(id: string, subscriptionId: string): RpcResponse {
  return {
    id,
    ok: true,
    streaming: true,
    result: { type: 'ready', subscriptionId },
    _meta: { runtimeId: 'runtime-1' }
  }
}

describe('desktop notification stream lifecycle', () => {
  it('never runs the ready arm when the disposer ran before the reply landed', () => {
    const rpc = registryClient()
    const stop = subscribeToDesktopNotifications(rpc.client, 'host-1')
    const subscribeFrame = rpc.sent[0]!
    expect(subscribeFrame.method).toBe('notifications.subscribe')

    stop()
    rpc.registry.handleResponse(readyReply(subscribeFrame.id, 'sub-1'))

    expect(reportPushToken).not.toHaveBeenCalled()
    // The subscription id never reaches this module, so nothing closes the host's stream.
    expect(rpc.requests).toEqual([])
    expect(rpc.sent).toHaveLength(1)
  })

  it('closes the host stream when the disposer runs after the ready reply', async () => {
    const rpc = registryClient()
    const stop = subscribeToDesktopNotifications(rpc.client, 'host-1')
    rpc.registry.handleResponse(readyReply(rpc.sent[0]!.id, 'sub-1'))

    stop()
    await Promise.resolve()

    expect(rpc.requests).toEqual([
      { method: 'notifications.unsubscribe', params: { subscriptionId: 'sub-1' } }
    ])
  })
})
