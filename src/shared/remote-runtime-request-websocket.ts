import WebSocket from 'ws'
import type { PairingOffer } from './pairing'
import { publicKeyFromBase64 } from './e2ee-crypto'
import { createDirectRuntimeHandshake, type RemoteRuntimeCipher } from './remote-runtime-transport'
import { RemoteRuntimeClientError } from './remote-runtime-client'
import {
  invalidRemoteRuntimeResponseError,
  remoteRuntimeUnavailableError
} from './remote-runtime-request-frames'

export type RemoteRuntimeWebSocket = {
  ws: WebSocket
  cipher: RemoteRuntimeCipher
  cleanup: () => void
}

export type RemoteRuntimeWebSocketCallbacks = {
  onClose: (ws: WebSocket, code: number, reason: Buffer) => void
  onError: (ws: WebSocket, error: RemoteRuntimeClientError) => void
  onTextFrame: (ws: WebSocket, frame: string) => void
  // Why: protocol-level pongs (and server heartbeat pings) are the liveness
  // signal for detecting half-open tunnels that never deliver `close` (#7718).
  onPong?: (ws: WebSocket) => void
  onPing?: (ws: WebSocket) => void
}

export function openRemoteRuntimeWebSocket(
  pairing: PairingOffer,
  callbacks: RemoteRuntimeWebSocketCallbacks
): { ok: true; socket: RemoteRuntimeWebSocket } | { ok: false; error: RemoteRuntimeClientError } {
  const opened = createSocket(pairing)
  if (!opened.ok) {
    return opened
  }
  const { ws, handshake } = opened

  let cleanedUp = false
  const onOpen = (): void => {
    ws.send(handshake.helloFrame)
  }
  const onError = (): void => {
    callbacks.onError(
      ws,
      remoteRuntimeUnavailableError('Could not connect to the remote Manta runtime.')
    )
  }
  const onClose = (code: number, reason: Buffer): void => callbacks.onClose(ws, code, reason)
  const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
    if (isBinary) {
      callbacks.onError(
        ws,
        invalidRemoteRuntimeResponseError(
          'Remote Manta runtime returned an unexpected binary frame.'
        )
      )
      return
    }
    callbacks.onTextFrame(ws, data.toString())
  }
  const onPong = (): void => callbacks.onPong?.(ws)
  const onPing = (): void => callbacks.onPing?.(ws)
  const cleanup = (): void => {
    if (cleanedUp) {
      return
    }
    cleanedUp = true
    ws.off('open', onOpen)
    ws.off('error', onError)
    ws.off('close', onClose)
    ws.off('message', onMessage)
    ws.off('pong', onPong)
    ws.off('ping', onPing)
    // Why: a manually closed ws can still emit a late transport error; keep
    // that from becoming an unhandled EventEmitter error after detaching Manta.
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.on('error', ignoreLateSocketError)
    }
  }

  ws.once('open', onOpen)
  ws.on('error', onError)
  ws.on('close', onClose)
  ws.on('message', onMessage)
  ws.on('pong', onPong)
  ws.on('ping', onPing)
  return { ok: true, socket: { ws, cipher: handshake.cipher, cleanup } }
}

function ignoreLateSocketError(): void {}

function createSocket(
  pairing: PairingOffer
):
  | { ok: true; ws: WebSocket; handshake: ReturnType<typeof createDirectRuntimeHandshake> }
  | { ok: false; error: RemoteRuntimeClientError } {
  let handshake: ReturnType<typeof createDirectRuntimeHandshake>
  try {
    handshake = createDirectRuntimeHandshake(pairing)
    publicKeyFromBase64(pairing.publicKeyB64)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: new RemoteRuntimeClientError(
        'invalid_argument',
        `Invalid remote pairing key: ${message}`
      )
    }
  }
  try {
    return { ok: true, ws: new WebSocket(pairing.endpoint), handshake }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: new RemoteRuntimeClientError('invalid_argument', `Invalid remote endpoint: ${message}`)
    }
  }
}
