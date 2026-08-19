/**
 * A minimal stand-in for the desktop and the phone.
 *
 * The host proof is answered by the *real* client implementation imported from
 * the desktop source, so these helpers cannot accidentally agree with a server
 * bug: if the transcript changes on either side, the handshake stops working
 * here first.
 */
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { answerRelayHostChallenge } from '../../../src/main/runtime/relay/relay-host-proof'
import { deriveRelayHostId } from '../shared/protocol.js'
import { TEST_USER } from './harness.js'

/**
 * Every request opens a fresh connection.
 *
 * Tests restart the relay on the same port, and a pooled keep-alive socket from
 * the previous process surfaces as ECONNRESET on the next POST — a test-harness
 * artefact, not a relay bug, but a very convincing-looking one.
 */
export function httpFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { connection: 'close', ...(init.headers as Record<string, string> | undefined) }
  })
}

export type HostIdentity = {
  relayHostId: string
  hostPublicKey: Buffer
  hostSecretKey: Uint8Array
}

export function newHostIdentity(): HostIdentity {
  const keys = nacl.box.keyPair()
  const hostPublicKey = Buffer.from(keys.publicKey)
  return {
    relayHostId: deriveRelayHostId(hostPublicKey),
    hostPublicKey,
    hostSecretKey: keys.secretKey
  }
}

export function nextJson(socket: WebSocket, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for frame')), timeoutMs)
    socket.once('message', (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse((raw as Buffer).toString('utf8')) as Record<string, unknown>)
    })
  })
}

export function nextClose(socket: WebSocket, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs)
    socket.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

export async function open(socket: WebSocket): Promise<WebSocket> {
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

/** Walks the loopback redirect the desktop performs, then redeems the code. */
export async function signIn(
  origin: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const redirectUri = 'http://127.0.0.1:1/auth/callback'
  const authorize = await httpFetch(
    `${origin}/v1/desktop/auth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=s1`,
    { redirect: 'manual' }
  )
  const location = authorize.headers.get('location')
  if (!location) {
    throw new Error(`authorize did not redirect (${authorize.status})`)
  }
  const code = new URL(location).searchParams.get('code')
  const response = await httpFetch(`${origin}/v1/desktop/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  })
  if (!response.ok) {
    throw new Error(`session exchange failed: ${response.status}`)
  }
  return (await response.json()) as { accessToken: string; refreshToken: string }
}

export async function relayTokenFor(
  origin: string,
  accessToken: string,
  relayHostId: string
): Promise<string> {
  const response = await httpFetch(`${origin}/v1/desktop/auth/relay-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ relayHostId })
  })
  if (!response.ok) {
    throw new Error(`relay-token failed: ${response.status}`)
  }
  return ((await response.json()) as { relayToken: string }).relayToken
}

/** Runs the four-step control handshake, answering with the real client code. */
export async function handshake(options: {
  origin: string
  relayToken: string
  identity: HostIdentity
  assignmentEpoch?: number
  previousGeneration?: number
  controlResumeSecret?: string
}): Promise<{ control: WebSocket; ack: Record<string, unknown> }> {
  const epoch = options.assignmentEpoch ?? 1
  const { identity } = options
  const control = await open(
    new WebSocket(`${options.origin.replace(/^http/, 'ws')}/v1/host/control`, {
      headers: { authorization: `Bearer ${options.relayToken}` }
    })
  )
  control.send(
    JSON.stringify({
      type: 'host-hello',
      v: 1,
      relayHostId: identity.relayHostId,
      assignmentEpoch: epoch,
      hostPublicKeyB64: identity.hostPublicKey.toString('base64'),
      appVersion: 'test',
      ...(options.previousGeneration === undefined
        ? {}
        : { previousGeneration: options.previousGeneration }),
      ...(options.controlResumeSecret === undefined
        ? {}
        : { controlResumeSecret: options.controlResumeSecret })
    })
  )
  const challenge = await nextJson(control)
  if (challenge.type !== 'host-challenge') {
    throw new Error(`expected challenge, got ${String(challenge.type)}`)
  }
  const proof = answerRelayHostChallenge(challenge as never, {
    relayOrigin: options.origin,
    userId: TEST_USER.userId,
    profileId: TEST_USER.profileId,
    organizationId: TEST_USER.organizationId,
    relayHostId: identity.relayHostId,
    hostPublicKey: identity.hostPublicKey,
    hostSecretKey: identity.hostSecretKey,
    assignmentEpoch: epoch,
    previousGeneration: options.previousGeneration,
    resumeRequested: options.controlResumeSecret !== undefined
  })
  if (!proof) {
    throw new Error('client refused the challenge')
  }
  control.send(
    JSON.stringify({
      type: 'host-challenge-ack',
      challengeId: challenge.challengeId,
      proofB64: proof
    })
  )
  return { control, ack: await nextJson(control) }
}

/** Signs in, mints a relay token, and completes the control handshake. */
export async function onlineHost(origin: string): Promise<{
  identity: HostIdentity
  relayToken: string
  control: WebSocket
  generation: number
  ack: Record<string, unknown>
}> {
  const session = await signIn(origin)
  const identity = newHostIdentity()
  const relayToken = await relayTokenFor(origin, session.accessToken, identity.relayHostId)
  const { control, ack } = await handshake({ origin, relayToken, identity })
  if (ack.type !== 'host-hello-ack') {
    throw new Error(`handshake failed: ${JSON.stringify(ack)}`)
  }
  return { identity, relayToken, control, generation: ack.generation as number, ack }
}

export async function createInvite(
  control: WebSocket,
  reqId: string,
  relayDeviceId: string
): Promise<Record<string, unknown>> {
  control.send(JSON.stringify({ type: 'invite-create', reqId, relayDeviceId }))
  return nextJson(control)
}

/** Opens a phone leg and sends its auth frame; returns the relay-hello reply. */
export async function connectPhone(
  wsOrigin: string,
  relayHostId: string,
  credential: string
): Promise<{ phone: WebSocket; hello: Record<string, unknown> }> {
  const phone = await open(new WebSocket(`${wsOrigin}/v1/connect/${relayHostId}`))
  phone.send(JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential }))
  return { phone, hello: await nextJson(phone) }
}

/** Opens the desktop data leg for a pending connection and authenticates it. */
export async function attachData(
  wsOrigin: string,
  connOpen: Record<string, unknown>,
  generation: number
): Promise<WebSocket> {
  const data = await open(
    new WebSocket(`${wsOrigin}/v1/host/data/${encodeURIComponent(String(connOpen.connId))}`)
  )
  data.send(
    JSON.stringify({
      type: 'host-data-auth',
      v: 1,
      connTicket: connOpen.connTicket,
      generation
    })
  )
  return data
}
