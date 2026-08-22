/**
 * What leaves the main process when an environment is described.
 *
 * The redacted projection reaches the renderer and `manta environment list
 * --json`, both of which the codebase treats as outside the trust boundary. A
 * relay block carries a live invite token, so it belongs on neither.
 */
import { describe, expect, it } from 'vitest'
import { redactRuntimeEnvironment, KnownRuntimeEnvironmentSchema } from './runtime-environments'

const relay = {
  v: 1 as const,
  directorUrl: 'https://relay.example.com',
  cellUrl: 'https://relay.example.com',
  assignmentEpoch: 1,
  relayHostId: 'AbCdEf0123_-xyZ9',
  inviteToken: 'B'.repeat(43),
  inviteExpiresAt: Date.now() + 5 * 60_000,
  e2eeFraming: 2 as const
}

function environment(withRelay: boolean) {
  return KnownRuntimeEnvironmentSchema.parse({
    id: 'env-1',
    name: 'Studio',
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: null,
    runtimeId: null,
    endpoints: [
      {
        id: 'ws-env-1',
        kind: 'websocket',
        label: 'WebSocket',
        endpoint: 'ws://192.168.1.10:8765',
        deviceToken: 'device-token',
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(7)).toString('base64'),
        ...(withRelay ? { relay } : {})
      }
    ],
    preferredEndpointId: 'ws-env-1'
  })
}

describe('redacting a runtime environment', () => {
  it('drops every credential, including the relay invite', () => {
    const redacted = redactRuntimeEnvironment(environment(true))
    const serialized = JSON.stringify(redacted)
    expect(serialized).not.toContain('device-token')
    expect(serialized).not.toContain(relay.inviteToken)
    // The whole block goes: cellUrl and relayHostId are only useful next to a
    // credential, and keeping them invites the token back later.
    expect(serialized).not.toContain(relay.cellUrl)
    expect(serialized).not.toContain(relay.relayHostId)
  })

  it('still says an endpoint is relay-reachable, so the UI can label it', () => {
    expect(redactRuntimeEnvironment(environment(true)).endpoints[0]).toMatchObject({
      endpoint: 'ws://192.168.1.10:8765',
      viaRelay: true
    })
  })

  it('leaves a direct-only endpoint unmarked', () => {
    const endpoint = redactRuntimeEnvironment(environment(false)).endpoints[0]
    expect(endpoint).toMatchObject({ endpoint: 'ws://192.168.1.10:8765' })
    expect(endpoint && 'viaRelay' in endpoint).toBe(false)
  })
})
