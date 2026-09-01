import type WebSocket from 'ws'
import {
  closeRuntimeControlSubscription,
  replayRuntimeControlSubscriptions,
  sendSharedControlRequest,
  sendSharedControlSubscription
} from './remote-runtime-shared-control-connection-actions'
import { requestSharedControl } from './remote-runtime-shared-control-requests'
import type { SharedControlRetiredRequestIds } from './remote-runtime-shared-control-retired-request-ids'
import { startSharedControlSubscription } from './remote-runtime-shared-control-subscription-start'
import type * as SharedControlTypes from './remote-runtime-shared-control-types'
import type { RuntimeOrchestrationEnvelope, RuntimeRpcResponse } from './runtime-rpc-envelope'

type PendingRequest = SharedControlTypes.SharedControlPendingRequest<unknown>
type LogicalSubscription = SharedControlTypes.SharedControlLogicalSubscription<unknown>

export type SharedControlChannelTransport = {
  state: SharedControlTypes.SharedControlConnectionState
  ws: WebSocket | null
  sharedKey: Uint8Array | null
}

export type SharedControlChannelPorts = {
  pendingRequests: Map<string, PendingRequest>
  subscriptions: Map<string, LogicalSubscription>
  retiredRequestIds: SharedControlRetiredRequestIds
  deviceToken: string
  ensureReady: (timeoutMs: number, signal?: AbortSignal) => Promise<void>
  /** Read per send: reconnects replace the socket under long-lived channels. */
  transport: () => SharedControlChannelTransport
  send: (payload: unknown) => boolean
  /** Lets a paused connection stop retrying once its last subscription closes. */
  clearWhenIdle: (isIdle: boolean) => void
}

/**
 * The logical channels multiplexed over one shared-control socket: one-shot RPCs and the
 * subscriptions that outlive a socket by being replayed onto its replacement.
 */
export class SharedControlChannelRegistry {
  // Why: replay tagging only makes sense for a resubscribe onto a later socket; the first
  // ready has no earlier snapshot to re-emit.
  everReady = false

  constructor(private readonly ports: SharedControlChannelPorts) {}

  request<TResult>(args: {
    method: string
    params: unknown
    timeoutMs: number
    envelope?: RuntimeOrchestrationEnvelope
    signal?: AbortSignal
  }): Promise<RuntimeRpcResponse<TResult>> {
    return requestSharedControl<TResult>({
      pendingRequests: this.ports.pendingRequests,
      deviceToken: this.ports.deviceToken,
      method: args.method,
      params: args.params,
      timeoutMs: args.timeoutMs,
      envelope: args.envelope,
      ensureReady: () => this.ports.ensureReady(args.timeoutMs, args.signal),
      send: (requestId) =>
        sendSharedControlRequest({
          pendingRequests: this.ports.pendingRequests,
          requestId,
          ...this.ports.transport()
        }),
      retireRequestId: (requestId) => this.ports.retiredRequestIds.retire(requestId),
      signal: args.signal
    })
  }

  subscribe<TResult>(args: {
    method: string
    params: unknown
    timeoutMs: number
    callbacks: SharedControlTypes.SharedControlSubscriptionCallbacks<TResult>
  }): Promise<SharedControlTypes.RemoteRuntimeSharedSubscription> {
    return startSharedControlSubscription({
      subscriptions: this.ports.subscriptions,
      deviceToken: this.ports.deviceToken,
      method: args.method,
      params: args.params,
      callbacks: args.callbacks,
      ensureReady: () => this.ports.ensureReady(args.timeoutMs),
      sendSubscription: (subscription) =>
        sendSharedControlSubscription({
          subscriptions: this.ports.subscriptions,
          subscription,
          deviceToken: this.ports.deviceToken,
          send: this.ports.send
        }),
      closeSubscription: (requestId) => this.closeSubscription(requestId)
    })
  }

  replaySubscriptions(): void {
    this.everReady = replayRuntimeControlSubscriptions({
      subscriptions: this.ports.subscriptions,
      deviceToken: this.ports.deviceToken,
      send: this.ports.send,
      tagReplayedResponses: this.everReady
    })
  }

  closeSubscription(requestId: string): void {
    closeRuntimeControlSubscription({
      subscriptions: this.ports.subscriptions,
      retiredRequestIds: this.ports.retiredRequestIds,
      requestId,
      deviceToken: this.ports.deviceToken,
      send: this.ports.send,
      clearWhenIdle: this.ports.clearWhenIdle
    })
  }
}
