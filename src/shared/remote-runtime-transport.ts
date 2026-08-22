/**
 * How a remote-runtime client gets an encrypted duplex to a host.
 *
 * There are two, and they differ in more than the address. A direct socket is
 * plain WebSocket plus this project's original E2EE: one ECDH shared key,
 * applied frame by frame by the client itself. A relay socket cannot use that —
 * the cell is an untrusted middlebox that can reorder and replay, so the host
 * refuses anything but mobile E2EE v2 on it, which brings per-direction keys,
 * exact frame counters, and a transcript bound to the host id.
 *
 * Rather than teach every client both handshakes, a connector hands back a
 * socket that is already as far along as its transport can get, plus the codec
 * for everything after. `authenticated` says whether the device token has
 * already been presented: over a relay it has, because the v2 auth frame is
 * part of the transport handshake rather than something the client can bolt on.
 */
import type WebSocket from 'ws'
import type { PairingOffer } from './pairing'
import {
  decrypt,
  decryptBytes,
  deriveSharedKey,
  encrypt,
  encryptBytes,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from './e2ee-crypto'

/** Frame codec for everything after the transport handshake. */
export type RemoteRuntimeCipher = {
  sealText: (plaintext: string) => string
  openText: (frame: string) => string | null
  sealBinary: (plaintext: Uint8Array<ArrayBufferLike>) => Uint8Array
  openBinary: (frame: Uint8Array<ArrayBufferLike>) => Uint8Array | null
}

export type RemoteRuntimeConnection = {
  ws: WebSocket
  cipher: RemoteRuntimeCipher
  /**
   * Sent once the socket opens, before anything else. Null when the transport
   * completed its own handshake and the client has nothing to negotiate.
   */
  helloFrame: string | null
  /**
   * True when the device token has already been accepted by the host, so the
   * client must skip its own `e2ee_auth` exchange and start issuing RPC.
   */
  authenticated: boolean
  /** Already open when handed over; the client will not see an 'open' event. */
  open: boolean
}

/**
 * Opens a connection for a pairing offer.
 *
 * Async because a relay connector has a whole handshake to finish before the
 * client may touch the socket — two owners of `ws.on('message')` is exactly
 * where this would go wrong.
 */
export type RemoteRuntimeConnector = (
  pairing: PairingOffer,
  options?: { signal?: AbortSignal }
) => Promise<RemoteRuntimeConnection>

/** The original single-shared-key codec, used on every direct socket. */
export function createDirectRuntimeCipher(sharedKey: Uint8Array): RemoteRuntimeCipher {
  return {
    sealText: (plaintext) => encrypt(plaintext, sharedKey),
    openText: (frame) => decrypt(frame, sharedKey),
    sealBinary: (plaintext) => encryptBytes(plaintext, sharedKey),
    openBinary: (frame) => decryptBytes(frame, sharedKey)
  }
}

/**
 * Derives the direct-socket key material and the hello that announces it.
 *
 * Throws on a malformed pinned key, which the callers report as
 * `invalid_argument` rather than as an unreachable host.
 */
export function createDirectRuntimeHandshake(pairing: PairingOffer): {
  cipher: RemoteRuntimeCipher
  helloFrame: string
} {
  const keyPair = generateKeyPair()
  const serverPublicKey = publicKeyFromBase64(pairing.publicKeyB64)
  return {
    cipher: createDirectRuntimeCipher(deriveSharedKey(keyPair.secretKey, serverPublicKey)),
    helloFrame: JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: publicKeyToBase64(keyPair.publicKey)
    })
  }
}
