/**
 * What a request connection does with each inbound frame.
 *
 * The same three stages as any Manta client — ready, authenticated, RPC — with
 * the transport's own state deciding which one applies. Split out because the
 * connection itself is about lifecycle: opening, idling, and closing.
 */
import type { RemoteRuntimeCipher } from './remote-runtime-transport'
import { remoteRuntimeClientCapabilities } from './remote-runtime-client-capabilities'
import { serializeRemoteRuntimePayload } from './remote-runtime-memory-limits'
import {
  invalidRemoteRuntimeResponseError,
  parseAuthenticatedFrame,
  parseReadyFrame
} from './remote-runtime-request-frames'
import { settleRemoteRuntimeRequestRpcFrame } from './remote-runtime-request-rpc-frame'
import type { RemoteRuntimePendingRequest } from './remote-runtime-prepared-request-admission'

export type RequestConnectionFrame = {
  frame: string
  state: 'closed' | 'awaiting_ready' | 'awaiting_authenticated' | 'ready'
  cipher: RemoteRuntimeCipher | null
  deviceToken: string
  pendingRequests: Map<string, RemoteRuntimePendingRequest<unknown>>
  send: (serialized: string) => void
  setState: (state: 'awaiting_authenticated' | 'ready') => void
  close: (error?: Error) => void
  becomeReady: () => void
  onSettled: () => void
}

export function handleRequestConnectionFrame(args: RequestConnectionFrame): void {
  if (args.state === 'awaiting_ready') {
    const error = parseReadyFrame(args.frame)
    if (error) {
      args.close(error)
      return
    }
    args.setState('awaiting_authenticated')
    if (args.cipher) {
      args.send(
        args.cipher.sealText(
          serializeRemoteRuntimePayload({
            type: 'e2ee_auth',
            deviceToken: args.deviceToken,
            clientCapabilities: remoteRuntimeClientCapabilities()
          })
        )
      )
    }
    return
  }

  if (!args.cipher) {
    return
  }
  const plaintext = args.cipher.openText(args.frame)
  if (plaintext === null) {
    args.close(
      invalidRemoteRuntimeResponseError('Remote Manta runtime returned an undecryptable frame.')
    )
    return
  }

  if (args.state === 'awaiting_authenticated') {
    const error = parseAuthenticatedFrame(plaintext)
    if (error) {
      args.close(error)
      return
    }
    args.becomeReady()
    return
  }

  const result = settleRemoteRuntimeRequestRpcFrame({
    plaintext,
    pendingRequests: args.pendingRequests
  })
  if (result.error) {
    args.close(result.error)
    return
  }
  if (result.resolved) {
    args.onSettled()
  }
}
