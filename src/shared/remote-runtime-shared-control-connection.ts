import WebSocket from 'ws'
import type { RemoteRuntimeCipher } from './remote-runtime-transport'
import type { PairingOffer } from './pairing'
import type { RemoteRuntimeClientError } from './remote-runtime-client-error'
import { remoteRuntimeUnavailableError } from './remote-runtime-request-frames'
import { handleSharedControlTextFrame } from './remote-runtime-shared-control-frame-handler'
import { openAndAdoptSharedControlSocket } from './remote-runtime-shared-control-adopt'
import * as sharedControlProtocol from './remote-runtime-shared-control-protocol'
import * as sharedControlReady from './remote-runtime-shared-control-ready'
import { SharedControlReconnectScheduler } from './remote-runtime-shared-control-reconnect'
import { requestSharedControl } from './remote-runtime-shared-control-requests'
import { SharedControlRetiredRequestIds } from './remote-runtime-shared-control-retired-request-ids'
import { SharedControlReadyStableResetTimer } from './remote-runtime-shared-control-stability'
import * as sharedControlState from './remote-runtime-shared-control-state'
import * as sharedControlOutbound from './remote-runtime-shared-control-outbound'
import { closeSharedControlSocket } from './remote-runtime-shared-control-socket-close'
import type { RemoteRuntimeSocketLivenessOptions } from './remote-runtime-socket-liveness'
import { startSharedControlSubscription } from './remote-runtime-shared-control-subscription-start'
import { SharedControlSocketGeneration } from './remote-runtime-shared-control-socket-generation'
import type * as SharedControlTypes from './remote-runtime-shared-control-types'
type PendingRequest = SharedControlTypes.SharedControlPendingRequest<unknown>
type LogicalSubscription = SharedControlTypes.SharedControlLogicalSubscription<unknown>
export class RemoteRuntimeSharedControlConnection {
  private state: SharedControlTypes.SharedControlConnectionState = 'closed'
  private ws: WebSocket | null = null
  private cipher: RemoteRuntimeCipher | null = null
  private socketCleanup: (() => void) | null = null
  private readonly reconnect = new SharedControlReconnectScheduler()
  private readonly readyStableReset: SharedControlReadyStableResetTimer
  private intentionallyClosed = false
  private lastConnectedAt: number | null = null
  private lastClose: { code: number; reason: string } | null = null
  private lastError: string | null = null
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly subscriptions = new Map<string, LogicalSubscription>()
  private readonly retiredRequestIds = new SharedControlRetiredRequestIds()
  private readonly readyWaiters: SharedControlTypes.SharedControlReadyWaiter[] = []
  private everReady = false
  private readonly socketGeneration = new SharedControlSocketGeneration()
  constructor(
    private readonly pairing: PairingOffer,
    private readonly options: {
      environmentId?: string
      reconnectStableResetMs?: number
      liveness?: RemoteRuntimeSocketLivenessOptions
    } = {}
  ) {
    this.readyStableReset = new SharedControlReadyStableResetTimer(
      options.reconnectStableResetMs ?? 30_000
    )
  }

  request<TResult>(
    method: string,
    params: unknown,
    timeoutMs: number,
    envelope?: Parameters<typeof requestSharedControl>[0]['envelope'],
    signal?: AbortSignal
  ): ReturnType<typeof requestSharedControl<TResult>> {
    return requestSharedControl<TResult>({
      pendingRequests: this.pendingRequests,
      deviceToken: this.pairing.deviceToken,
      method,
      params,
      timeoutMs,
      envelope,
      ensureReady: () => this.ensureReadyWithTimeout(timeoutMs, signal),
      send: (requestId) => this.sendRequest(requestId),
      retireRequestId: (requestId) => this.retiredRequestIds.retire(requestId),
      signal
    })
  }

  async subscribe<TResult>(
    method: string,
    params: unknown,
    timeoutMs: number,
    callbacks: SharedControlTypes.SharedControlSubscriptionCallbacks<TResult>
  ): Promise<SharedControlTypes.RemoteRuntimeSharedSubscription> {
    return startSharedControlSubscription({
      subscriptions: this.subscriptions,
      deviceToken: this.pairing.deviceToken,
      method,
      params,
      callbacks,
      ensureReady: () => this.ensureReadyWithTimeout(timeoutMs),
      sendSubscription: (subscription) => this.sendSubscription(subscription),
      closeSubscription: (requestId) => this.closeSubscription(requestId)
    })
  }

  close(error?: Error): void {
    this.intentionallyClosed = true
    this.socketGeneration.invalidate()
    this.reconnect.clear()
    for (const subscription of Array.from(this.subscriptions.values())) {
      this.closeSubscription(subscription.requestId)
    }
    this.closeSocket(error)
  }

  readonly retryNow = (): boolean => this.reconnect.retryNow()

  getDiagnostics(): SharedControlTypes.RemoteRuntimeSharedConnectionDiagnostics {
    return sharedControlState.buildSharedControlDiagnostics({
      state: this.state,
      reconnecting: this.reconnect.isScheduled,
      pendingRequestCount: this.pendingRequests.size,
      subscriptionCount: this.subscriptions.size,
      reconnectAttempt: this.reconnect.attemptCount,
      lastConnectedAt: this.lastConnectedAt,
      lastClose: this.lastClose,
      lastError: this.lastError
    })
  }

  reconnectNow(): void {
    if (this.intentionallyClosed || this.isReady()) {
      return
    }
    // Why: a successful one-shot status probe proves the restarted endpoint is reachable; replace even a stuck CONNECTING/awaiting-ready socket instead of waiting behind stale backoff.
    this.closeSocket(
      remoteRuntimeUnavailableError('Refreshing remote runtime control transport.'),
      true
    )
    this.open()
  }

  private ensureReadyWithTimeout(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (this.isReady()) {
      return Promise.resolve()
    }
    return sharedControlReady.waitForSharedControlReadyWithTimeout({
      readyWaiters: this.readyWaiters,
      timeoutMs,
      signal,
      open: () => {
        if (
          !this.ws ||
          this.ws.readyState === WebSocket.CLOSED ||
          this.ws.readyState === WebSocket.CLOSING
        ) {
          this.open()
        }
      }
    })
  }

  private isReady(): boolean {
    return sharedControlReady.isSharedControlReady({
      state: this.state,
      ws: this.ws,
      cipher: this.cipher
    })
  }

  private open(): void {
    if (this.intentionallyClosed) {
      sharedControlState.rejectSharedControlReadyWaiters(
        this.readyWaiters,
        remoteRuntimeUnavailableError()
      )
      return
    }
    this.reconnect.clear()
    void this.openSocket(this.socketGeneration.begin())
  }

  private openSocket(socketGeneration: number): Promise<void> {
    return openAndAdoptSharedControlSocket({
      pairing: this.pairing,
      getCurrentSocket: () => this.ws,
      onClose: (close, error) => {
        if (this.socketGeneration.isCurrent(socketGeneration)) {
          this.lastClose = close
        }
        this.handleSocketClosed(error, socketGeneration)
      },
      onTextFrame: (frame) => this.handleTextFrame(frame, socketGeneration),
      ...(this.options.liveness ? { livenessOptions: this.options.liveness } : {}),
      handleSocketClosed: (error) => this.handleSocketClosed(error, socketGeneration),
      isCurrent: () =>
        this.socketGeneration.isCurrent(socketGeneration) && !this.intentionallyClosed,
      adopt: (socket) => {
        this.ws = socket.ws
        this.cipher = socket.cipher
        this.socketCleanup = socket.cleanup
      },
      ...this.readyHooks()
    })
  }

  /** What "this socket is usable now" means, wherever readiness is reached. */
  private readyHooks(): Pick<
    Parameters<typeof handleSharedControlTextFrame>[0],
    'readyWaiters' | 'setState' | 'markReady' | 'replaySubscriptions'
  > {
    return {
      readyWaiters: this.readyWaiters,
      setState: (state) => {
        this.state = state
      },
      markReady: () => {
        this.lastConnectedAt = Date.now()
        this.readyStableReset.schedule({
          getState: () => this.state,
          getSocket: () => this.ws,
          reset: () => this.reconnect.resetAttempt()
        })
      },
      replaySubscriptions: () => this.replaySubscriptions()
    }
  }

  private handleTextFrame(frame: string, socketGeneration: number): void {
    if (!this.socketGeneration.isCurrent(socketGeneration)) {
      return
    }
    handleSharedControlTextFrame({
      frame,
      state: this.state,
      cipher: this.cipher,
      environmentId: this.options.environmentId,
      deviceToken: this.pairing.deviceToken,
      pendingRequests: this.pendingRequests,
      subscriptions: this.subscriptions,
      retiredRequestIds: this.retiredRequestIds,
      handleSocketClosed: (error) => this.handleSocketClosed(error, socketGeneration),
      sendEncrypted: (payload) => this.sendEncrypted(payload),
      ...this.readyHooks()
    })
  }

  private sendRequest(requestId: string): void {
    sharedControlOutbound.sendSharedControlPendingRequest(this.outbound(), requestId)
  }

  private sendSubscription(subscription: LogicalSubscription): void {
    sharedControlOutbound.sendSharedControlLogicalSubscription(this.outbound(), subscription)
  }

  private replaySubscriptions(): void {
    sharedControlOutbound.replaySharedControlLogicalSubscriptions(this.outbound(), this.everReady)
    this.everReady = true
  }

  private closeSubscription(requestId: string): void {
    sharedControlOutbound.closeSharedControlLogicalSubscription(this.outbound(), requestId)
    this.reconnect.clearWhenIdle(this.subscriptions.size === 0 && this.state === 'closed')
  }

  private sendEncrypted(payload: unknown): boolean {
    return sharedControlProtocol.sendSharedControlEncrypted({
      state: this.state,
      ws: this.ws,
      cipher: this.cipher,
      payload
    })
  }

  /** Everything the outbound helpers need, gathered once per call. */
  private outbound(): sharedControlOutbound.SharedControlOutbound {
    return {
      state: this.state,
      ws: this.ws,
      cipher: this.cipher,
      deviceToken: this.pairing.deviceToken,
      pendingRequests: this.pendingRequests,
      subscriptions: this.subscriptions,
      retiredRequestIds: this.retiredRequestIds,
      sendSubscription: (subscription) => this.sendSubscription(subscription)
    }
  }

  private handleSocketClosed(error: RemoteRuntimeClientError, socketGeneration: number): void {
    if (
      !this.socketGeneration.acceptClose({
        generation: socketGeneration,
        error,
        everReady: this.everReady,
        subscriptions: this.subscriptions,
        closeSocket: () => this.closeSocket(error)
      })
    ) {
      return
    }
    this.lastError = error.message
    if (this.subscriptions.size > 0 && !this.intentionallyClosed) {
      this.reconnect.scheduleWithDefaultBackoff(this.intentionallyClosed, () => this.open())
    }
  }

  private closeSocket(error?: Error, preserveReadyWaitersAndPendingRequests = false): void {
    closeSharedControlSocket({
      environmentId: this.options.environmentId,
      state: this.state,
      pendingRequests: this.pendingRequests,
      subscriptions: this.subscriptions,
      readyWaiters: this.readyWaiters,
      lastClose: this.lastClose,
      socketCleanup: this.socketCleanup,
      ws: this.ws,
      error,
      preserveReadyWaitersAndPendingRequests,
      clearReadyStableTimer: () => this.readyStableReset.clear()
    })
    this.ws = this.cipher = null
    this.socketCleanup = null
    this.state = 'closed'
  }
}
