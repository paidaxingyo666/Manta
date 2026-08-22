/**
 * Opening a request connection's socket.
 *
 * Async because a relay transport finishes credential, E2EE, and device auth
 * before the socket is usable — which also means the connection may have been
 * closed, or already re-opened, by the time one lands. The generation is what
 * makes that safe: a socket from a superseded attempt is dropped rather than
 * adopted, so nothing is left live and untracked.
 */
import type { RemoteRuntimeWebSocket } from './remote-runtime-request-websocket'
import { openRemoteRuntimeConnection } from './remote-runtime-request-websocket'
import type { PairingOffer } from './pairing'
import type { RemoteRuntimeClientError } from './remote-runtime-client-error'

export type RequestConnectionOpen = {
  pairing: PairingOffer
  generation: number
  currentGeneration: () => number
  onClose: () => void
  onError: (error: RemoteRuntimeClientError) => void
  onTextFrame: (frame: string) => void
  isCurrentSocket: (ws: RemoteRuntimeWebSocket['ws']) => boolean
  adopt: (socket: RemoteRuntimeWebSocket) => void
  becomeReady: () => void
  awaitHandshake: () => void
}

export async function openRequestConnectionSocket(args: RequestConnectionOpen): Promise<void> {
  const opened = await openRemoteRuntimeConnection(args.pairing, {
    onClose: (ws) => {
      if (args.isCurrentSocket(ws)) {
        args.onClose()
      }
    },
    onError: (ws, error) => {
      if (args.isCurrentSocket(ws)) {
        args.onError(error)
      }
    },
    onTextFrame: (ws, frame) => {
      if (args.isCurrentSocket(ws)) {
        args.onTextFrame(frame)
      }
    }
  })
  if (args.generation !== args.currentGeneration()) {
    if (opened.ok) {
      opened.socket.cleanup()
      opened.socket.ws.close()
    }
    return
  }
  if (!opened.ok) {
    args.onError(opened.error)
    return
  }
  args.adopt(opened.socket)
  if (opened.socket.authenticated) {
    // A relay transport already ran E2EE and presented the device token.
    args.becomeReady()
    return
  }
  args.awaitHandshake()
}
