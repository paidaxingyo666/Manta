/**
 * A desktop reaching another desktop through a relay cell.
 *
 * The far side here is the *real* host stack — `MobileSocketWiring` over
 * `CloudRelayTransport`, the same objects a phone talks to — so the dialer
 * cannot accidentally agree with a bug in its own peer implementation. The cell
 * is a splice, which is all a cell does once a credential checks out.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { DeviceRegistry } from '../device-registry'
import { MobileSocketWiring } from '../rpc/mobile-socket-wiring'
import { CloudRelayTransport } from '../rpc/relay-transport'
import { deriveRelayHostId } from './relay-http-client'
import { dialRelayPeer } from './relay-peer-dialer'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function forward(socket: WebSocket, raw: RawData, isBinary: boolean): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(raw, { binary: isBinary })
  }
}

const INVITE = 'B'.repeat(43)
const CONN_TICKET = 'A'.repeat(43)

describe('relay peer dialer', () => {
  const servers: WebSocketServer[] = []
  const transports: CloudRelayTransport[] = []
  const userDataPaths: string[] = []

  afterEach(async () => {
    await Promise.all(transports.splice(0).map((transport) => transport.stop()))
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            for (const client of server.clients) {
              client.terminate()
            }
            server.close(() => resolve())
          })
      )
    )
    for (const path of userDataPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  async function startCell(relayHostId: string): Promise<number> {
    const cell = new WebSocketServer({ port: 0, perMessageDeflate: false })
    servers.push(cell)
    await new Promise<void>((resolve) => cell.once('listening', resolve))
    let hostLeg: WebSocket | null = null
    let peerLeg: WebSocket | null = null
    const splice = (): void => {
      if (!hostLeg || !peerLeg) {
        return
      }
      const host = hostLeg
      const peer = peerLeg
      host.on('message', (raw, isBinary) => forward(peer, raw, isBinary))
      peer.on('message', (raw, isBinary) => forward(host, raw, isBinary))
      peer.send(
        JSON.stringify({
          type: 'relay-hello',
          ok: true,
          credentialKind: 'invite',
          leaseExpiresAt: Date.now() + 60_000
        })
      )
    }
    cell.on('connection', (socket, request) => {
      if (request.url === '/v1/host/data/connection-1') {
        socket.once('message', () => {
          hostLeg = socket
          splice()
        })
        return
      }
      if (request.url === `/v1/connect/${relayHostId}`) {
        socket.once('message', (raw) => {
          expect(JSON.parse(raw.toString())).toMatchObject({
            type: 'relay-auth',
            mode: 'connect',
            credential: INVITE
          })
          peerLeg = socket
          splice()
        })
      }
    })
    const address = cell.address()
    if (!address || typeof address === 'string') {
      throw new Error('expected a local cell address')
    }
    return address.port
  }

  async function startHost(
    port: number,
    scope: 'mobile' | 'runtime',
    desktopKeys: nacl.BoxKeyPair
  ) {
    const userDataPath = mkdtempSync(join(tmpdir(), 'manta-relay-peer-'))
    userDataPaths.push(userDataPath)
    const registry = new DeviceRegistry(userDataPath)
    const device = registry.addDevice('Peer desktop', scope)
    const relayHostId = deriveRelayHostId(desktopKeys.publicKey)
    const receivedText = deferred<string>()
    const wiring = new MobileSocketWiring({
      deviceRegistry: registry,
      e2eeKeypair: {
        publicKey: desktopKeys.publicKey,
        secretKey: desktopKeys.secretKey,
        publicKeyB64: Buffer.from(desktopKeys.publicKey).toString('base64')
      },
      onText: (_socket, plaintext, reply) => {
        receivedText.resolve(plaintext)
        reply(JSON.stringify({ id: 'rpc-1', ok: true, result: { path: 'relay' } }))
      },
      onBinary: vi.fn(),
      onClose: vi.fn()
    })
    const transport = new CloudRelayTransport({
      cellUrl: `http://127.0.0.1:${port}`,
      relayHostId,
      generation: 1
    })
    transports.push(transport)
    wiring.attachTransport(transport, (socket) => transport.metadataFor(socket))
    await transport.start()
    await transport.openConnection({
      connId: 'connection-1',
      connTicket: CONN_TICKET,
      kind: 'invite',
      relayDeviceId: device.deviceId,
      attachDeadlineMs: 5_000
    })
    return { device, desktopKeys, relayHostId, receivedText, wiring }
  }

  function relayFor(port: number, relayHostId: string) {
    return {
      v: 1 as const,
      directorUrl: 'https://relay.example.com',
      cellUrl: `http://127.0.0.1:${port}`,
      assignmentEpoch: 1,
      relayHostId,
      inviteToken: INVITE,
      inviteExpiresAt: Date.now() + 5 * 60_000,
      e2eeFraming: 2 as const
    }
  }

  it('carries plaintext RPC both ways once the handshake finishes', async () => {
    // The dialer's job is to hand back a socket that is already authenticated,
    // so the caller's first frame is RPC rather than a handshake.
    const desktopKeys = nacl.box.keyPair()
    const relayHostId = deriveRelayHostId(desktopKeys.publicKey)
    const port = await startCell(relayHostId)
    const host = await startHost(port, 'runtime', desktopKeys)

    const connection = await dialRelayPeer({
      relay: relayFor(port, relayHostId),
      deviceToken: host.device.token,
      desktopPublicKeyB64: Buffer.from(desktopKeys.publicKey).toString('base64')
    })

    const reply = deferred<string>()
    connection.ws.on('message', (raw, isBinary) => {
      const plaintext = isBinary
        ? null
        : connection.cipher.openText((raw as Buffer).toString('utf8'))
      if (plaintext !== null) {
        reply.resolve(plaintext)
      }
    })
    connection.ws.send(connection.cipher.sealText(JSON.stringify({ id: 'rpc-1', method: 'ping' })))

    await expect(host.receivedText.promise).resolves.toBe(
      JSON.stringify({ id: 'rpc-1', method: 'ping' })
    )
    await expect(reply.promise).resolves.toBe(
      JSON.stringify({ id: 'rpc-1', ok: true, result: { path: 'relay' } })
    )
    connection.ws.terminate()
  }, 20_000)

  it('refuses when the far side is not the desktop the offer pinned', async () => {
    // The transcript is verified against the pinned key, so a cell that spliced
    // the caller to a different host fails the handshake rather than proceeding.
    const desktopKeys = nacl.box.keyPair()
    const relayHostId = deriveRelayHostId(desktopKeys.publicKey)
    const port = await startCell(relayHostId)
    const host = await startHost(port, 'runtime', desktopKeys)
    const impostor = nacl.box.keyPair()
    await expect(
      dialRelayPeer({
        relay: relayFor(port, relayHostId),
        deviceToken: host.device.token,
        desktopPublicKeyB64: Buffer.from(impostor.publicKey).toString('base64')
      })
    ).rejects.toMatchObject({ code: 'remote_runtime_unavailable' })
  }, 20_000)

  it('rejects a malformed pinned key before opening anything', async () => {
    await expect(
      dialRelayPeer({
        relay: relayFor(1, 'AbCdEf0123_-xyZ9'),
        deviceToken: 'token',
        desktopPublicKeyB64: 'too-short'
      })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
  })
})
