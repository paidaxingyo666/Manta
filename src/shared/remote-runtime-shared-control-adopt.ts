import type WebSocket from 'ws'
import type { PairingOffer } from './pairing'
import type { RemoteRuntimeWebSocket } from './remote-runtime-request-websocket'
import { openSharedControlSocket } from './remote-runtime-shared-control-open'
import type { RemoteRuntimeSocketLivenessOptions } from './remote-runtime-socket-liveness'
import type { RemoteRuntimeClientError } from './remote-runtime-client-error'
import { becomeSharedControlReady } from './remote-runtime-shared-control-frame-handler'
import type {
  SharedControlConnectionState,
  SharedControlReadyWaiter
} from './remote-runtime-shared-control-types'

export type SharedControlAdoption = {
  opened:
    | { ok: true; socket: RemoteRuntimeWebSocket }
    | { ok: false; error: RemoteRuntimeClientError }
  /** False once a newer connect superseded this one, or the caller closed. */
  isCurrent: () => boolean
  adopt: (socket: RemoteRuntimeWebSocket) => void
  handleSocketClosed: (error: RemoteRuntimeClientError) => void
  readyWaiters: SharedControlReadyWaiter[]
  setState: (state: SharedControlConnectionState) => void
  markReady: () => void
  replaySubscriptions: () => void
}

/**
 * Takes ownership of a socket a connect attempt produced.
 *
 * A relay dial is async, so by the time it lands the connection may have been
 * closed or already re-opened. Adopting the socket then would leave a live
 * connection nothing is tracking — and the caller's own reconnect would race it.
 */
export function adoptSharedControlSocket(args: SharedControlAdoption): void {
  const { opened } = args
  if (!args.isCurrent()) {
    if (opened.ok) {
      opened.socket.cleanup()
      closeQuietly(opened.socket.ws)
    }
    return
  }
  if (!opened.ok) {
    args.handleSocketClosed(opened.error)
    return
  }
  args.adopt(opened.socket)
  if (!opened.socket.authenticated) {
    args.setState('awaiting_ready')
    return
  }
  // A relay transport already ran E2EE and presented the device token, so there
  // is no handshake frame left to wait for.
  becomeSharedControlReady(args)
}

function closeQuietly(ws: WebSocket): void {
  try {
    ws.close()
  } catch {
    // Already gone; nothing is listening either way.
  }
}

/** Opens a shared-control socket and hands it to the connection that asked. */
export async function openAndAdoptSharedControlSocket(
  args: {
    pairing: PairingOffer
    getCurrentSocket: () => WebSocket | null
    onClose: (close: { code: number; reason: string }, error: RemoteRuntimeClientError) => void
    onTextFrame: (frame: string) => void
    livenessOptions?: RemoteRuntimeSocketLivenessOptions
    handleSocketClosed: (error: RemoteRuntimeClientError) => void
  } & Omit<SharedControlAdoption, 'opened' | 'handleSocketClosed'>
): Promise<void> {
  const opened = await openSharedControlSocket(args.pairing, {
    getCurrentSocket: args.getCurrentSocket,
    onClose: args.onClose,
    onError: args.handleSocketClosed,
    onTextFrame: args.onTextFrame,
    liveness: {
      ...(args.livenessOptions ? { options: args.livenessOptions } : {}),
      onDead: args.handleSocketClosed
    }
  })
  adoptSharedControlSocket({ ...args, opened })
}
