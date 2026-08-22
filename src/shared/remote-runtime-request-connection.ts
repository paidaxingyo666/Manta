import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { abortSignalReason } from './abort-signal-reason'
import type { PairingOffer } from './pairing'
import { scheduleOrphanedRemoteRuntimeSocketClose } from './remote-runtime-abort-orphaned-socket'
import type { RemoteRuntimeCipher } from './remote-runtime-transport'
import { serializeRemoteRuntimeRpcRequest } from './remote-runtime-memory-limits'
import {
  prepareRemoteRuntimeRequest,
  releaseRemoteRuntimePreparedRequest,
  takeRemoteRuntimePreparedRequest,
  toRemoteRuntimeRequestError,
  type RemoteRuntimePendingRequest,
  type RemoteRuntimePreparedRequest
} from './remote-runtime-prepared-request-admission'
import {
  remoteRuntimeTimeoutError,
  remoteRuntimeUnavailableError
} from './remote-runtime-request-frames'
import type { RuntimeRpcResponse } from './runtime-rpc-envelope'
import {
  rejectRemoteRuntimeRequestReadyWaiters,
  resolveRemoteRuntimeRequestReadyWaiters,
  waitForRemoteRuntimeRequestReady,
  type RemoteRuntimeRequestReadyWaiter
} from './remote-runtime-request-ready-waiters'
import { openRequestConnectionSocket } from './remote-runtime-request-open'
import { handleRequestConnectionFrame } from './remote-runtime-request-frame-handler'
type ConnectionState = 'closed' | 'awaiting_ready' | 'awaiting_authenticated' | 'ready'
const IDLE_CLOSE_MS = 60_000

export class RemoteRuntimeRequestConnection {
  private state: ConnectionState = 'closed'
  private ws: WebSocket | null = null
  private cipher: RemoteRuntimeCipher | null = null
  /**
   * Bumped by every open and every close.
   *
   * A relay dial is async, so the connection can be closed — or re-opened —
   * while one is in flight. Adopting that socket afterwards would leave a live
   * connection nothing is tracking.
   */
  private openGeneration = 0
  private opening = false
  private socketCleanup: (() => void) | null = null
  private readonly pendingRequests = new Map<string, RemoteRuntimePendingRequest<unknown>>()
  private readonly readyWaiters: RemoteRuntimeRequestReadyWaiter[] = []
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly pairing: PairingOffer) {}

  request<TResult>(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<RuntimeRpcResponse<TResult>> {
    if (signal?.aborted) {
      return Promise.reject(abortSignalReason(signal))
    }
    const requestId = randomUUID()
    let preparedRequest: RemoteRuntimePreparedRequest
    try {
      preparedRequest = prepareRemoteRuntimeRequest(this.pendingRequests, () =>
        serializeRemoteRuntimeRpcRequest({
          requestId,
          deviceToken: this.pairing.deviceToken,
          method,
          params
        })
      )
    } catch (error) {
      return Promise.reject(toRemoteRuntimeRequestError(error))
    }
    this.clearIdleCloseTimer()
    return new Promise<RuntimeRpcResponse<TResult>>((resolve, reject) => {
      const onAbort = (): void => {
        const error = abortSignalReason(signal!)
        this.rejectPendingRequest(requestId, error)
        scheduleOrphanedRemoteRuntimeSocketClose(
          () =>
            this.pendingRequests.size === 0 &&
            this.readyWaiters.length === 0 &&
            this.state !== 'ready',
          () => this.close(error)
        )
      }
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(requestId)
        if (!pending) {
          return
        }
        this.pendingRequests.delete(requestId)
        releaseRemoteRuntimePreparedRequest(pending)
        const error = remoteRuntimeTimeoutError()
        pending.reject(error)
        this.close(error)
      }, timeoutMs)
      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(response as RuntimeRpcResponse<TResult>)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
        timeout,
        preparedRequest
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }

      void this.ensureReady(signal).then(
        () => this.sendRequest(requestId),
        (error) => this.rejectPendingRequest(requestId, toRemoteRuntimeRequestError(error))
      )
    })
  }

  close(error?: Error): void {
    this.openGeneration += 1
    const ws = this.ws
    const cleanup = this.socketCleanup
    this.ws = this.cipher = null
    this.socketCleanup = null
    this.state = 'closed'
    this.clearIdleCloseTimer()

    const closeError = error ?? remoteRuntimeUnavailableError()
    rejectRemoteRuntimeRequestReadyWaiters(this.readyWaiters, closeError)
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(requestId)
      releaseRemoteRuntimePreparedRequest(pending)
      pending.reject(closeError)
    }

    try {
      cleanup?.()
      ws?.close()
    } catch {
      // Best-effort shutdown for a cached remote control connection.
    }
  }

  private ensureReady(signal?: AbortSignal): Promise<void> {
    const ws = this.ws
    if (this.state === 'ready' && ws?.readyState === WebSocket.OPEN && this.cipher) {
      return Promise.resolve()
    }

    const promise = waitForRemoteRuntimeRequestReady(this.readyWaiters, signal)

    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      try {
        this.open()
      } catch (error) {
        this.close(toRemoteRuntimeRequestError(error))
      }
    }

    return promise
  }

  /**
   * A relay transport has a handshake to finish before the socket is usable, so
   * this cannot be synchronous. `opening` keeps a second caller from starting a
   * parallel dial while the first is still in flight.
   */
  private open(): void {
    if (this.opening) {
      return
    }
    this.opening = true
    const generation = ++this.openGeneration
    void openRequestConnectionSocket({
      pairing: this.pairing,
      generation,
      currentGeneration: () => this.openGeneration,
      isCurrentSocket: (ws) => this.ws === ws,
      onClose: () => this.close(),
      onError: (error) => this.close(error),
      onTextFrame: (frame) => this.handleTextFrame(frame),
      adopt: (socket) => {
        this.ws = socket.ws
        this.cipher = socket.cipher
        this.socketCleanup = socket.cleanup
      },
      awaitHandshake: () => {
        this.state = 'awaiting_ready'
      },
      becomeReady: () => {
        this.state = 'ready'
        resolveRemoteRuntimeRequestReadyWaiters(this.readyWaiters)
        this.scheduleIdleCloseIfUnused()
      }
    }).finally(() => {
      this.opening = false
    })
  }

  private handleTextFrame(frame: string): void {
    handleRequestConnectionFrame({
      frame,
      state: this.state,
      cipher: this.cipher,
      deviceToken: this.pairing.deviceToken,
      pendingRequests: this.pendingRequests,
      send: (serialized) => this.ws?.send(serialized),
      setState: (state) => {
        this.state = state
      },
      close: (error) => this.close(error),
      becomeReady: () => {
        this.state = 'ready'
        resolveRemoteRuntimeRequestReadyWaiters(this.readyWaiters)
        this.scheduleIdleCloseIfUnused()
      },
      onSettled: () => this.scheduleIdleCloseIfUnused()
    })
  }

  private sendRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId)
    const ws = this.ws
    const cipher = this.cipher
    if (!pending) {
      return
    }
    if (this.state !== 'ready' || !ws || ws.readyState !== WebSocket.OPEN || !cipher) {
      this.rejectPendingRequest(requestId, remoteRuntimeUnavailableError())
      return
    }
    const serializedRequest = takeRemoteRuntimePreparedRequest(pending)
    if (serializedRequest === null) {
      this.rejectPendingRequest(requestId, remoteRuntimeUnavailableError())
      return
    }
    try {
      ws.send(cipher.sealText(serializedRequest))
    } catch (error) {
      this.rejectPendingRequest(requestId, toRemoteRuntimeRequestError(error))
    }
  }

  private rejectPendingRequest(requestId: string, error: Error): void {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) {
      return
    }
    this.pendingRequests.delete(requestId)
    clearTimeout(pending.timeout)
    releaseRemoteRuntimePreparedRequest(pending)
    pending.reject(error)
    this.scheduleIdleCloseIfUnused()
  }

  private scheduleIdleCloseIfUnused(): void {
    if (this.pendingRequests.size > 0 || this.readyWaiters.length > 0 || this.state !== 'ready') {
      return
    }
    this.clearIdleCloseTimer()
    this.idleCloseTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS)
    if (typeof this.idleCloseTimer.unref === 'function') {
      this.idleCloseTimer.unref()
    }
  }

  private clearIdleCloseTimer(): void {
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer)
      this.idleCloseTimer = null
    }
  }
}
