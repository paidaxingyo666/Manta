import { describe, expect, it } from 'vitest'
import { clientFrame, createFakeRpcClient } from './bridge-host-test-fakes'
import { harness, ROUTE } from './bridge-host-test-harness'
import {
  BRIDGE_MAX_PENDING_REQUESTS,
  BRIDGE_MAX_ROUTE_PATHNAME_CHARS,
  BRIDGE_MAX_SUBSCRIPTIONS
} from './bridge/bridge-caps'
import { BRIDGE_FAULT_GRANT } from './bridge/bridge-envelope'

describe('init and state', () => {
  it('answers ready with the getters, the caps it enforces, and the one native grant', () => {
    const client = createFakeRpcClient({
      getState: () => 'reconnecting',
      getReconnectAttempt: () => 3,
      getLastConnectedAt: () => 1_700_000_000_000,
      getLastInboundAt: () => 1_700_000_000_500,
      getGeneration: () => 7
    })
    const bridge = harness({ client })
    bridge.host.receive(clientFrame({ type: 'ready' }))
    expect(bridge.last()).toEqual({
      v: 1,
      type: 'init',
      sessionId: 'session-a',
      buildId: 'build-a',
      connection: {
        state: 'reconnecting',
        reconnectAttempt: 3,
        lastConnectedAt: 1_700_000_000_000,
        lastInboundAt: 1_700_000_000_500,
        generation: 7
      },
      grants: {
        rpc: {
          maxPendingRequests: BRIDGE_MAX_PENDING_REQUESTS,
          maxSubscriptions: BRIDGE_MAX_SUBSCRIPTIONS
        },
        native: [BRIDGE_FAULT_GRANT]
      },
      route: ROUTE
    })
  })

  it('names the screen the page is standing in for, which its own `/` cannot tell it', () => {
    const route = { pathname: '/h/host-a/session/wt-1', params: { name: 'a branch' } }
    const bridge = harness({ route })
    bridge.host.receive(clientFrame({ type: 'ready' }))
    const init = bridge.last()
    expect(init.type === 'init' && init.route).toEqual(route)
  })

  it('refuses to open a session at all for a route the protocol does not allow', () => {
    // The producer interpolates a host id into this pathname, so every one of these is reachable
    // from a deep link. Without the check the page refuses the whole `init`, asks again on its
    // backoff forever, and the shell un-hides a WebView that never paints.
    for (const pathname of [
      '/h/a?b',
      '/h/a#b',
      '/h/a b',
      '/h/..',
      '/../../etc',
      '/h/a\\b',
      '//evil',
      `/h/${'a'.repeat(BRIDGE_MAX_ROUTE_PATHNAME_CHARS)}`
    ]) {
      const bridge = harness({ route: { pathname } })
      bridge.host.receive(clientFrame({ type: 'ready' }))
      expect(bridge.posted, pathname).toEqual([])
      expect(bridge.routeRefusals, pathname).toHaveLength(1)
      expect(
        bridge.diagnostics.map((diagnostic) => diagnostic.kind),
        pathname
      ).toEqual(['route-refused'])
    }
  })

  it('opens a session for the routes a screen actually produces', () => {
    for (const pathname of ['/h/host-a', '/h/host-a/tasks', '/h/a%20b', '/']) {
      const bridge = harness({ route: { pathname } })
      bridge.host.receive(clientFrame({ type: 'ready' }))
      expect(bridge.last().type, pathname).toBe('init')
      expect(bridge.routeRefusals, pathname).toEqual([])
    }
  })

  it('reports a client without the optional getters as null rather than omitting the field', () => {
    const bridge = harness()
    bridge.host.receive(clientFrame({ type: 'ready' }))
    const init = bridge.last()
    expect(init.type === 'init' && init.connection).toEqual({
      state: 'connected',
      reconnectAttempt: 0,
      lastConnectedAt: null,
      lastInboundAt: null,
      generation: null
    })
  })

  it('re-answers ready, which is how a page that missed a state frame recovers', () => {
    const bridge = harness()
    bridge.host.receive(clientFrame({ type: 'ready' }))
    bridge.host.receive(clientFrame({ type: 'ready' }))
    expect(bridge.frames().filter((frame) => frame.type === 'init')).toHaveLength(2)
  })

  it('tells the shell the page spoke, on the first ask and on every re-ask', () => {
    const bridge = harness()
    expect(bridge.pageReadyCount()).toBe(0)
    bridge.host.receive(clientFrame({ type: 'ready' }))
    bridge.host.receive(clientFrame({ type: 'ready' }))
    // The shell bounds the wait for the first of these; a page on its backoff must not have to
    // land a particular one to end it.
    expect(bridge.pageReadyCount()).toBe(2)
  })

  it('says nothing about a page that never asked, however much else it posts', () => {
    const bridge = harness()
    bridge.host.receive(clientFrame({ type: 'notify', name: 'foreground' }))
    expect(bridge.pageReadyCount()).toBe(0)
  })

  it('pushes the event state, not the getter a listener can outrun', () => {
    const bridge = harness()
    bridge.client.pushState('disconnected')
    const pushed = bridge.last()
    expect(pushed.type === 'state' && pushed.connection.state).toBe('disconnected')
  })

  it('drops the state listener on dispose', () => {
    const bridge = harness()
    expect(bridge.client.stateListeners()).toBe(1)
    bridge.host.dispose()
    expect(bridge.client.stateListeners()).toBe(0)
  })
})
