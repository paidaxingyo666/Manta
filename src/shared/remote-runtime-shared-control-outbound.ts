/**
 * What a shared-control connection sends, gathered in one place.
 *
 * These were five thin methods on the connection, each re-reading the same
 * socket, cipher, and registry state. Collecting that into one snapshot per
 * call makes the wiring visible and keeps the connection itself about
 * lifecycle rather than framing.
 */
import type WebSocket from 'ws'
import type { RemoteRuntimeCipher } from './remote-runtime-transport'
import {
  sendSharedControlEncrypted,
  sendSharedControlEncryptedSerialized
} from './remote-runtime-shared-control-protocol'
import {
  sendSharedControlRequest,
  sendSharedControlSubscription
} from './remote-runtime-shared-control-send'
import { rejectSharedControlPendingRequest } from './remote-runtime-shared-control-state'
import { replaySharedControlSubscriptions } from './remote-runtime-shared-control-subscriptions'
import { closeSharedControlConnectionSubscription } from './remote-runtime-shared-control-subscription-close'
import type { SharedControlRetiredRequestIds } from './remote-runtime-shared-control-retired-request-ids'
import type {
  SharedControlConnectionState,
  SharedControlLogicalSubscription,
  SharedControlPendingRequest
} from './remote-runtime-shared-control-types'

export type SharedControlOutbound = {
  state: SharedControlConnectionState
  ws: WebSocket | null
  cipher: RemoteRuntimeCipher | null
  deviceToken: string
  pendingRequests: Map<string, SharedControlPendingRequest<unknown>>
  subscriptions: Map<string, SharedControlLogicalSubscription<unknown>>
  retiredRequestIds: SharedControlRetiredRequestIds
  /** Re-entrant: a replay sends each subscription through the same path. */
  sendSubscription: (subscription: SharedControlLogicalSubscription<unknown>) => void
}

function send(outbound: SharedControlOutbound, payload: unknown): boolean {
  return sendSharedControlEncrypted({
    state: outbound.state,
    ws: outbound.ws,
    cipher: outbound.cipher,
    payload
  })
}

export function sendSharedControlPendingRequest(
  outbound: SharedControlOutbound,
  requestId: string
): void {
  sendSharedControlRequest({
    pendingRequests: outbound.pendingRequests,
    requestId,
    send: (serialized) =>
      sendSharedControlEncryptedSerialized({
        state: outbound.state,
        ws: outbound.ws,
        cipher: outbound.cipher,
        serialized
      }),
    reject: (id, error) => rejectSharedControlPendingRequest(outbound.pendingRequests, id, error)
  })
}

export function sendSharedControlLogicalSubscription(
  outbound: SharedControlOutbound,
  subscription: SharedControlLogicalSubscription<unknown>
): void {
  sendSharedControlSubscription({
    subscriptions: outbound.subscriptions,
    subscription,
    deviceToken: outbound.deviceToken,
    send: (payload) => send(outbound, payload)
  })
}

export function replaySharedControlLogicalSubscriptions(
  outbound: SharedControlOutbound,
  everReady: boolean
): void {
  replaySharedControlSubscriptions({
    subscriptions: outbound.subscriptions,
    send: (subscription) => outbound.sendSubscription(subscription),
    tagReplayedResponses: everReady
  })
}

export function closeSharedControlLogicalSubscription(
  outbound: SharedControlOutbound,
  requestId: string
): void {
  closeSharedControlConnectionSubscription({
    subscriptions: outbound.subscriptions,
    retiredRequestIds: outbound.retiredRequestIds,
    requestId,
    deviceToken: outbound.deviceToken,
    send: (payload) => send(outbound, payload)
  })
}
