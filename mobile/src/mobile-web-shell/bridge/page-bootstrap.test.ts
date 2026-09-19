import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_PROTOCOL_VERSION } from './bridge-envelope'
import type { OrcaBridgePageChannel } from './manta-bridge-page-channel'
import {
  bootstrapShellPage,
  createShellPageClient,
  PAGE_BUILD_ID_KEY,
  PAGE_MOUNT_STATE_KEY,
  PAGE_SESSION_ID_KEY,
  stampPageMountState,
  type PageMountTarget
} from './page-bootstrap'
import type { BridgeRpcClient, BridgeShellSession } from './bridge-rpc-client'

const INIT = {
  v: BRIDGE_PROTOCOL_VERSION,
  type: 'init',
  sessionId: 'session-a',
  buildId: 'build-a',
  connection: {
    state: 'connected',
    reconnectAttempt: 0,
    lastConnectedAt: 1700,
    lastInboundAt: 1800,
    generation: 3
  },
  grants: { rpc: { maxPendingRequests: 64, maxSubscriptions: 32 }, native: [] }
}

function createTarget(): PageMountTarget {
  return { dataset: {} }
}

/** The channel the shell's document-start script installs, as a double. */
function installChannel(): { posted: string[]; deliver: (frame: unknown) => void } {
  const posted: string[] = []
  const channel: OrcaBridgePageChannel = {
    postMessage: (json) => {
      posted.push(json)
    },
    onmessage: null
  }
  Object.defineProperty(globalThis, 'orcaBridge', { value: channel, configurable: true })
  return {
    posted,
    deliver: (frame) => {
      channel.onmessage?.({ data: JSON.stringify(frame) })
    }
  }
}

type Mounted = { client: BridgeRpcClient; session: BridgeShellSession }

function bootstrap(target: PageMountTarget): {
  mounts: Mounted[]
  client: BridgeRpcClient | null
} {
  const mounts: Mounted[] = []
  const client = createShellPageClient()
  bootstrapShellPage({
    target,
    client,
    mount: (mountedClient, session) => {
      mounts.push({ client: mountedClient, session })
    }
  })
  return { mounts, client }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'orcaBridge')
})

describe('the page bootstrap inside the shell', () => {
  it('asks for a session and mounts nothing until the shell answers', () => {
    const channel = installChannel()
    const target = createTarget()
    const { mounts } = bootstrap(target)

    expect(channel.posted.map((json) => JSON.parse(json).type)).toEqual(['ready'])
    expect(mounts).toHaveLength(0)
    expect(target.dataset[PAGE_MOUNT_STATE_KEY]).toBeUndefined()
    // The handshake keeps asking rather than waiting out an `init` that has been and gone, and
    // still nothing is mounted while it does.
    vi.advanceTimersByTime(5_000)
    expect(channel.posted.length).toBeGreaterThan(1)
    expect(mounts).toHaveLength(0)
  })

  it('mounts the client it was given once init lands, and stamps the session on the document', () => {
    const channel = installChannel()
    const target = createTarget()
    const { mounts, client } = bootstrap(target)

    channel.deliver(INIT)

    expect(mounts).toHaveLength(1)
    expect(mounts[0]?.client).toBe(client)
    expect(mounts[0]?.session.sessionId).toBe('session-a')
    expect(target.dataset[PAGE_MOUNT_STATE_KEY]).toBe('shell-ready')
    expect(target.dataset[PAGE_SESSION_ID_KEY]).toBe('session-a')
    expect(target.dataset[PAGE_BUILD_ID_KEY]).toBe('build-a')
  })

  it('stamps the session before it mounts, so a tree that throws still names its build', () => {
    const channel = installChannel()
    const target = createTarget()
    const client = createShellPageClient()
    bootstrapShellPage({
      target,
      client,
      mount: () => {
        expect(target.dataset[PAGE_BUILD_ID_KEY]).toBe('build-a')
        throw new Error('the route tree threw')
      }
    })

    expect(() => {
      channel.deliver(INIT)
    }).toThrow('the route tree threw')
    expect(target.dataset[PAGE_MOUNT_STATE_KEY]).toBe('shell-ready')
  })

  it('mounts one tree for one document, whatever the shell sends next', () => {
    const channel = installChannel()
    const target = createTarget()
    const { mounts } = bootstrap(target)

    channel.deliver(INIT)
    channel.deliver({ ...INIT, sessionId: 'session-b', buildId: 'build-b' })

    expect(mounts).toHaveLength(1)
    expect(target.dataset[PAGE_SESSION_ID_KEY]).toBe('session-a')
  })

  it('mounts at once when the client already holds a session', () => {
    const channel = installChannel()
    const client = createShellPageClient()
    channel.deliver(INIT)
    const target = createTarget()
    const mounts: Mounted[] = []

    bootstrapShellPage({
      target,
      client,
      mount: (mountedClient, session) => {
        mounts.push({ client: mountedClient, session })
      }
    })

    expect(mounts).toHaveLength(1)
    expect(target.dataset[PAGE_MOUNT_STATE_KEY]).toBe('shell-ready')
  })
})

describe('the page bootstrap outside the shell', () => {
  it('builds no client when nothing installed a channel', () => {
    expect(createShellPageClient()).toBeNull()
  })

  it('says so and mounts nothing, because no init is ever coming', () => {
    const target = createTarget()
    const { mounts } = bootstrap(target)

    expect(mounts).toHaveLength(0)
    expect(target.dataset[PAGE_MOUNT_STATE_KEY]).toBe('unbridged')
    expect(target.dataset[PAGE_SESSION_ID_KEY]).toBeUndefined()
  })
})

describe('the mount state attribute', () => {
  it('records the last state reached, so the entry can say its script ran', () => {
    const target = createTarget()
    stampPageMountState(target, 'started')
    expect(target.dataset[PAGE_MOUNT_STATE_KEY]).toBe('started')
    stampPageMountState(target, 'mounted')
    expect(target.dataset[PAGE_MOUNT_STATE_KEY]).toBe('mounted')
  })
})
