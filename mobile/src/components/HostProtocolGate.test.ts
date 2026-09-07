import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { HostProtocolGate, useHostProtocolGates } from './HostProtocolGate'

const nativeTestState = vi.hoisted(() => ({
  openUrl: vi.fn(),
  platform: { OS: 'ios' as 'ios' | 'android' }
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: nativeTestState.openUrl },
  Platform: nativeTestState.platform,
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T>(styles: T) => styles,
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('expo-router', () => ({
  router: { replace: vi.fn() }
}))

// Why: mock only client acquisition; the gate must exercise the real
// useHostStatusGates → evaluateCompat → ProtocolBlockScreen wiring.
const hostClient = vi.hoisted(() => ({
  current: { client: null as RpcClient | null, state: 'disconnected' as string }
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => hostClient.current
}))

function clientWithStatus(result: Record<string, unknown>): RpcClient {
  return { sendRequest: vi.fn().mockResolvedValue({ ok: true, result }) } as unknown as RpcClient
}

function GateConsumer() {
  const { hostCapabilities } = useHostProtocolGates()
  return createElement('GateStatus', null, hostCapabilities.join(','))
}

// Separate from GateStatus so the capability assertions keep their exact rendered shape.
function VerifiedConsumer() {
  const { compatVerified } = useHostProtocolGates()
  return createElement('GateVerified', null, compatVerified ? 'verified' : 'unverified')
}

// Counts mounts so a test can prove the routes were never torn down, which presence alone can't.
const probeMounts = { count: 0 }
function MountProbe() {
  useEffect(() => {
    probeMounts.count += 1
  }, [])
  return createElement('MountProbe')
}

function gateElement() {
  return createElement(
    HostProtocolGate,
    { hostId: 'host-1' },
    createElement(
      'HostContent',
      null,
      createElement(GateConsumer),
      createElement(VerifiedConsumer),
      createElement(MountProbe)
    )
  )
}

async function renderGate(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(gateElement())
    await Promise.resolve()
  })
  return renderer as unknown as ReactTestRenderer
}

function renderedText(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON())
}

describe('HostProtocolGate', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    nativeTestState.openUrl.mockClear()
    nativeTestState.platform.OS = 'ios'
    probeMounts.count = 0
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('replaces the host UI with the block screen when mobile is too old', async () => {
    // Why: blocked warns to console; keep test output clean without hiding other errors.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    hostClient.current = {
      client: clientWithStatus({ protocolVersion: 5, minCompatibleMobileVersion: 999 }),
      state: 'connected'
    }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('Update Manta Mobile')
    expect(output).toContain('Open App Store')
    expect(output).not.toContain('HostContent')
  })

  it('routes Android mobile updates to GitHub Releases', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    nativeTestState.platform.OS = 'android'
    hostClient.current = {
      client: clientWithStatus({ protocolVersion: 5, minCompatibleMobileVersion: 999 }),
      state: 'connected'
    }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('Update Manta Mobile')
    expect(output).toContain('Update Manta Mobile from GitHub Releases')
    expect(output).toContain('Open GitHub Releases')
    expect(output).not.toContain('mobile app store')
    expect(output).not.toContain('HostContent')
    act(() => renderer?.root.findAllByType('Pressable')[0]?.props.onPress())
    expect(nativeTestState.openUrl).toHaveBeenCalledWith(
      'https://github.com/stablyai/orca/releases'
    )
  })

  it('replaces the host UI with the block screen when desktop is too old', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    hostClient.current = {
      client: clientWithStatus({ protocolVersion: 0, minCompatibleMobileVersion: 0 }),
      state: 'connected'
    }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('Update Manta on your computer')
    expect(output).toContain('Open GitHub Releases')
    expect(output).not.toContain('HostContent')
  })

  it('renders the host UI when the verdict is ok', async () => {
    const client = clientWithStatus({
      protocolVersion: 5,
      minCompatibleMobileVersion: 0,
      capabilities: ['browser.screencast.v1']
    })
    hostClient.current = {
      client,
      state: 'connected'
    }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('HostContent')
    expect(output).toContain('browser.screencast.v1')
    expect(output).not.toContain('Update Manta')
    expect(client.sendRequest).toHaveBeenCalledOnce()
  })

  it('serves every descendant capability read from the one status.get it issues', async () => {
    const client = clientWithStatus({
      protocolVersion: 5,
      minCompatibleMobileVersion: 0,
      capabilities: ['browser.screencast.v1', 'terminal.queryReplyInput.v1']
    })
    hostClient.current = { client, state: 'connected' }
    renderer = await act(async () => {
      const created = create(
        createElement(
          HostProtocolGate,
          { hostId: 'host-1' },
          createElement(GateConsumer),
          createElement(GateConsumer)
        )
      )
      await Promise.resolve()
      return created
    })

    // Why: the session route used to run its own retrying status.get on top of this one, so a
    // cold open cost two round trips for the same answer. Consumers now read the gate's copy.
    expect(client.sendRequest).toHaveBeenCalledOnce()
    expect(client.sendRequest).toHaveBeenCalledWith('status.get')
    const statuses = renderer.root.findAllByType('GateStatus')
    expect(statuses).toHaveLength(2)
    for (const status of statuses) {
      expect(status.props.children).toBe('browser.screencast.v1,terminal.queryReplyInput.v1')
    }
  })

  it('releases the cover on a failed status.get and upgrades when a retry lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('status.get timed out'))
      .mockResolvedValue({
        ok: true,
        result: { protocolVersion: 5, minCompatibleMobileVersion: 0, capabilities: ['late.v1'] }
      })
    hostClient.current = { client: { sendRequest } as unknown as RpcClient, state: 'connected' }
    renderer = await renderGate()

    // Why: a wedged status.get must never trap the routes behind the cover, so the first miss
    // settles conservative gates immediately — no capabilities, but a usable UI.
    let output = renderedText(renderer)
    expect(output).toContain('HostContent')
    expect(output).not.toContain('Checking host compatibility')
    expect(output).toContain('"type":"GateStatus","props":{},"children":null')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100)
    })

    // The probe kept retrying underneath, so the answer arrives without a remount.
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(renderedText(renderer)).toContain('late.v1')
    expect(probeMounts.count).toBe(1)
    vi.useRealTimers()
  })

  it('blocks a desktop that omits protocolVersion, so a pending verdict is not a formality', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Why this case and not just an explicit old version: evaluateCompat reads a missing
    // protocolVersion as 0, so the everyday shape of an old desktop is a blocking one.
    hostClient.current = {
      client: clientWithStatus({ capabilities: [] }),
      state: 'connected'
    }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('Update Manta on your computer')
    expect(output).not.toContain('HostContent')
  })

  it('renders the host UI while the host connection is still pending', async () => {
    hostClient.current = { client: null, state: 'connecting' }
    renderer = await renderGate()
    expect(renderedText(renderer)).toContain('HostContent')
  })

  // Was: the routes were held back until status.get resolved, which serialised every route's
  // own startup RPC behind this one round trip. They now mount immediately and are covered.
  it('mounts host routes under the pending cover while status.get is still in flight', async () => {
    const client = {
      sendRequest: vi.fn().mockReturnValue(new Promise(() => {}))
    } as unknown as RpcClient
    hostClient.current = { client, state: 'connected' }
    renderer = await renderGate()
    const output = renderedText(renderer)
    expect(output).toContain('Checking host compatibility')
    expect(output).toContain('HostContent')
    expect(probeMounts.count).toBe(1)
    expect(client.sendRequest).toHaveBeenCalledOnce()
    // Why: mounting early must not leak an unproven host's capabilities to the routes below;
    // an empty join renders no children, so the consumer saw none.
    expect(output).toContain('"type":"GateStatus","props":{},"children":null')
    const overlay = renderer.root
      .findAllByType('View')
      .find((node) => node.props.accessibilityViewIsModal === true)
    expect(overlay?.props.pointerEvents).toBe('auto')
  })

  it('unmounts the routes it mounted early when the verdict comes back blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let settle: ((response: unknown) => void) | null = null
    const client = {
      sendRequest: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          settle = resolve
        })
      )
    } as unknown as RpcClient
    hostClient.current = { client, state: 'connected' }
    renderer = await renderGate()
    expect(renderedText(renderer)).toContain('HostContent')

    await act(async () => {
      settle?.({ ok: true, result: { protocolVersion: 5, minCompatibleMobileVersion: 999 } })
      await Promise.resolve()
    })

    const output = renderedText(renderer)
    expect(output).toContain('Update Manta Mobile')
    expect(output).not.toContain('HostContent')
  })

  it('overlays the pending spinner instead of unmounting routes mounted while connecting', async () => {
    hostClient.current = { client: null, state: 'connecting' }
    renderer = await renderGate()
    expect(renderedText(renderer)).toContain('HostContent')
    expect(probeMounts.count).toBe(1)

    const client = {
      sendRequest: vi.fn().mockReturnValue(new Promise(() => {}))
    } as unknown as RpcClient
    await act(async () => {
      hostClient.current = { client, state: 'connected' }
      renderer?.update(gateElement())
      await Promise.resolve()
    })

    const output = renderedText(renderer)
    expect(output).toContain('HostContent')
    expect(output).toContain('Checking host compatibility')
    // Why: the cold-start remount this replaces is exactly what destroys in-flight deep navigation.
    expect(probeMounts.count).toBe(1)
    const overlay = renderer.root
      .findAllByType('View')
      .find((node) => node.props.accessibilityViewIsModal === true)
    expect(overlay?.props.pointerEvents).toBe('auto')
  })

  it('still replaces mounted routes when the verdict comes back blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    hostClient.current = { client: null, state: 'connecting' }
    renderer = await renderGate()
    expect(renderedText(renderer)).toContain('HostContent')

    await act(async () => {
      hostClient.current = {
        client: clientWithStatus({ protocolVersion: 5, minCompatibleMobileVersion: 999 }),
        state: 'connected'
      }
      renderer?.update(gateElement())
      await Promise.resolve()
    })

    const output = renderedText(renderer)
    expect(output).toContain('Update Manta Mobile')
    expect(output).not.toContain('HostContent')
  })

  it('keeps an already-validated host route mounted while reconnect status is pending', async () => {
    const client = {
      sendRequest: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          result: { protocolVersion: 5, minCompatibleMobileVersion: 0 }
        })
        .mockReturnValueOnce(new Promise(() => {}))
    } as unknown as RpcClient
    hostClient.current = { client, state: 'connected' }
    renderer = await renderGate()

    await act(async () => {
      hostClient.current = { client, state: 'disconnected' }
      renderer?.update(gateElement())
    })
    await act(async () => {
      hostClient.current = { client, state: 'connected' }
      renderer?.update(gateElement())
      await Promise.resolve()
    })

    const output = renderedText(renderer)
    expect(output).toContain('HostContent')
    // Why: the host already answered once, so a reconnect probe must not dim the UI it validated.
    expect(output).not.toContain('Checking host compatibility')
    expect(client.sendRequest).toHaveBeenCalledTimes(2)
  })

  it('fails open when a connected host cannot answer the status probe', async () => {
    hostClient.current = {
      client: {
        sendRequest: vi.fn().mockResolvedValue({ ok: false, error: { message: 'unavailable' } })
      } as unknown as RpcClient,
      state: 'connected'
    }
    renderer = await renderGate()
    expect(renderedText(renderer)).toContain('HostContent')
  })

  it('reports a rejected status.get as unverified, so failing open is not a passing verdict', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { message: 'no such method' } })
    hostClient.current = { client: { sendRequest } as unknown as RpcClient, state: 'connected' }
    renderer = await renderGate()

    // Navigation still works: the host said no, and that must not lock the user out of the route.
    const output = renderedText(renderer)
    expect(output).toContain('HostContent')
    expect(output).not.toContain('Checking host compatibility')
    // Why: `compatVerdict` is `ok` here purely as a fallback. Nothing about this host was proven,
    // so callers that write to it read this flag instead of the verdict.
    expect(output).toContain('["unverified"]')
  })

  it('reports a passing status reply as verified', async () => {
    hostClient.current = {
      client: clientWithStatus({ protocolVersion: 5, minCompatibleMobileVersion: 0 }),
      state: 'connected'
    }
    renderer = await renderGate()
    expect(renderedText(renderer)).toContain('["verified"]')
  })

  it('stays unverified through a failed status.get and flips once a retry answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('status.get timed out'))
      .mockResolvedValue({
        ok: true,
        result: { protocolVersion: 5, minCompatibleMobileVersion: 0 }
      })
    hostClient.current = { client: { sendRequest } as unknown as RpcClient, state: 'connected' }
    renderer = await renderGate()

    expect(renderedText(renderer)).toContain('["unverified"]')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100)
    })

    // The retry landed, so the fallback is replaced by a real answer and writes are released.
    expect(renderedText(renderer)).toContain('["verified"]')
    vi.useRealTimers()
  })
})
