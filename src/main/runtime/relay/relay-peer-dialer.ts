/**
 * Reaching another desktop through a relay cell.
 *
 * The cell has never known what kind of device is on the far end of a
 * connection — it checks a credential and splices bytes — so a desktop uses the
 * same leg a phone does. What it must also do is speak mobile E2EE v2, because
 * the host refuses anything else over a relay: the cell can reorder and replay,
 * and only v2 has the counters and the transcript binding that make that
 * harmless.
 *
 * The whole handshake finishes here, device token included, before the socket
 * is handed over. Two owners of `ws.on('message')` is exactly where this would
 * go wrong, and the v2 auth frame is transcript-bound, so it cannot be
 * something the caller bolts on afterwards.
 */
import nacl from 'tweetnacl'
import WebSocket from 'ws'
import type { PairingRelay } from '../../../shared/mobile-relay-pairing-offer'
import { RelayPhoneHelloSchema } from '../../../shared/mobile-relay-phone-protocol'
import { remoteRuntimeClientCapabilities } from '../../../shared/remote-runtime-client-capabilities'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime-client-error'
import { REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES } from '../../../shared/remote-runtime-memory-limits'
import type { RemoteRuntimeCipher } from '../../../shared/remote-runtime-transport'
import { MobileE2EEV2PeerSession } from './mobile-e2ee-v2-peer-session'

/** Long enough for a cold cell and a sleeping host, short enough to report. */
const DIAL_TIMEOUT_MS = 20_000

export type RelayPeerDialInput = {
  relay: PairingRelay
  deviceToken: string
  /** Pinned in the pairing offer; the v2 transcript is checked against it. */
  desktopPublicKeyB64: string
  /** Defaults to the offer's invite token. */
  credential?: string
  credentialKind?: 'invite' | 'resume'
  signal?: AbortSignal
  createSocket?: (url: string) => WebSocket
}

export type RelayPeerConnection = { ws: WebSocket; cipher: RemoteRuntimeCipher }

export function relayPeerWebSocketUrl(relay: PairingRelay): string {
  const url = new URL(relay.cellUrl)
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  url.pathname = `/v1/connect/${encodeURIComponent(relay.relayHostId)}`
  return url.toString()
}

/**
 * Every relay failure is a reachability failure, never evidence about what is
 * running on the far side. The close code travels so the caller can tell an
 * offline host from a refused credential without guessing.
 */
function dialFailure(message: string, closeCode?: number): RemoteRuntimeClientError {
  return new RemoteRuntimeClientError('remote_runtime_unavailable', message, {
    pairingStage: 'connect',
    ...(closeCode === undefined ? {} : { closeCode })
  })
}

type Stage = 'awaiting-relay-hello' | 'awaiting-e2ee-ready' | 'awaiting-authenticated'

export async function dialRelayPeer(input: RelayPeerDialInput): Promise<RelayPeerConnection> {
  const desktopPublicKey = Uint8Array.from(Buffer.from(input.desktopPublicKeyB64, 'base64'))
  if (desktopPublicKey.byteLength !== 32) {
    throw new RemoteRuntimeClientError(
      'invalid_argument',
      'Relay pairing offer carries a malformed desktop public key.'
    )
  }
  const peer = new MobileE2EEV2PeerSession(
    nacl.box.keyPair(),
    desktopPublicKey,
    input.relay.relayHostId
  )
  const create = input.createSocket ?? ((url) => wsForRelay(url))
  const ws = create(relayPeerWebSocketUrl(input.relay))

  return await new Promise<RelayPeerConnection>((resolve, reject) => {
    let stage: Stage = 'awaiting-relay-hello'
    let settled = false
    const timer = setTimeout(
      () => fail(dialFailure('Timed out reaching the remote Manta desktop through the relay.')),
      DIAL_TIMEOUT_MS
    )

    const detach = (): void => {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      ws.off('open', onOpen)
      ws.off('message', onMessage)
      ws.off('error', onError)
      ws.off('close', onClose)
    }

    function fail(error: Error): void {
      if (settled) {
        return
      }
      settled = true
      detach()
      // The caller never sees this socket, so nothing else will close it.
      ws.on('error', () => {
        // A socket being torn down can still report a late transport error.
      })
      try {
        ws.close()
      } catch {
        // Already gone.
      }
      reject(error)
    }

    function succeed(): void {
      if (settled) {
        return
      }
      settled = true
      detach()
      // Between detaching and the caller attaching its own, the socket has no
      // 'error' listener — and an unheard 'error' is an uncaughtException the
      // main-process guard re-throws. The caller's listener adds to this one.
      ws.on('error', ignoreDialedSocketError)
      resolve({
        ws,
        cipher: {
          sealText: (plaintext) => peer.sealText(plaintext),
          openText: (frame) => peer.openText(frame),
          sealBinary: (plaintext) => peer.sealBinary(plaintext),
          openBinary: (frame) => peer.openBinary(frame)
        }
      })
    }

    function onAbort(): void {
      fail(dialFailure('The relay connection was cancelled.'))
    }

    function onOpen(): void {
      ws.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 1,
          mode: 'connect',
          credential: input.credential ?? input.relay.inviteToken
        })
      )
    }

    function onError(): void {
      fail(dialFailure('Could not reach the relay.'))
    }

    function onClose(code: number): void {
      fail(dialFailure('The relay closed the connection before it was ready.', code))
    }

    function onMessage(raw: WebSocket.RawData, isBinary: boolean): void {
      try {
        step(raw, isBinary)
      } catch (error) {
        fail(error instanceof Error ? error : dialFailure(String(error)))
      }
    }

    function step(raw: WebSocket.RawData, isBinary: boolean): void {
      if (stage === 'awaiting-relay-hello') {
        acceptRelayHello(raw, isBinary)
        return
      }
      if (stage === 'awaiting-e2ee-ready') {
        acceptE2eeReady(raw, isBinary)
        return
      }
      acceptAuthenticated(raw, isBinary)
    }

    function acceptRelayHello(raw: WebSocket.RawData, isBinary: boolean): void {
      if (isBinary) {
        throw dialFailure('The relay answered the credential with a binary frame.')
      }
      const parsed = RelayPhoneHelloSchema.safeParse(JSON.parse(raw.toString()))
      if (!parsed.success) {
        throw dialFailure('The relay answered the credential with an unreadable frame.')
      }
      if (!parsed.data.ok) {
        throw dialFailure('The relay refused the pairing credential.', parsed.data.code)
      }
      if (parsed.data.credentialKind !== (input.credentialKind ?? 'invite')) {
        throw dialFailure('The relay accepted the credential as an unexpected kind.')
      }
      stage = 'awaiting-e2ee-ready'
      ws.send(JSON.stringify(peer.hello))
    }

    function acceptE2eeReady(raw: WebSocket.RawData, isBinary: boolean): void {
      if (isBinary || !peer.acceptReady(JSON.parse(raw.toString()))) {
        // A ready frame that does not verify means the far end is not the
        // desktop whose key the pairing offer pinned.
        throw dialFailure('The remote Manta desktop failed the end-to-end handshake.')
      }
      stage = 'awaiting-authenticated'
      // Exactly these keys: the host compares the shape as well as the
      // transcript hash, and rejects anything it does not expect.
      ws.send(
        peer.sealText(
          JSON.stringify({
            type: 'e2ee_auth',
            v: 2,
            transcriptHashB64: peer.transcriptHashB64,
            deviceToken: input.deviceToken,
            clientCapabilities: remoteRuntimeClientCapabilities()
          })
        )
      )
    }

    function acceptAuthenticated(raw: WebSocket.RawData, isBinary: boolean): void {
      const plaintext = isBinary ? null : peer.openText(raw.toString())
      if (plaintext === null) {
        throw dialFailure('The remote Manta desktop returned an undecryptable frame.')
      }
      const message = JSON.parse(plaintext) as { type?: unknown }
      if (message.type !== 'e2ee_authenticated') {
        throw new RemoteRuntimeClientError(
          'unauthorized',
          'The remote Manta desktop rejected the pairing token.',
          { pairingStage: 'access-grant' }
        )
      }
      succeed()
    }

    timer.unref?.()
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) {
      onAbort()
      return
    }
    ws.on('message', onMessage)
    ws.on('error', onError)
    ws.on('close', onClose)
    if (ws.readyState === WebSocket.OPEN) {
      onOpen()
    } else {
      ws.once('open', onOpen)
    }
  })
}

function ignoreDialedSocketError(): void {}

function wsForRelay(url: string): WebSocket {
  return new WebSocket(url, {
    perMessageDeflate: false,
    maxPayload: REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES
  })
}
