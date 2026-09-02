import { describe, expect, it } from 'vitest'
import {
  hostConnectionPathTargets,
  summarizeHostConnectionPaths
} from './host-connection-path-probe'

const RELAY_HOST = {
  endpoint: 'ws://192.168.1.20:6768',
  endpoints: [
    { id: 'lan-primary', kind: 'lan' as const, url: 'ws://192.168.1.20:6768' },
    { id: 'relay-primary', kind: 'relay' as const, url: 'wss://relay.manta.sh.cn/v1/connect/x' }
  ]
}

describe('hostConnectionPathTargets', () => {
  it('returns every configured path, not just the paired direct address', () => {
    expect(hostConnectionPathTargets(RELAY_HOST).map((target) => target.kind)).toEqual([
      'lan',
      'relay'
    ])
  })

  it('falls back to the direct endpoint when a host predates the overlay', () => {
    expect(hostConnectionPathTargets({ endpoint: 'ws://192.168.1.20:6768' })).toEqual([
      { kind: 'lan', url: 'ws://192.168.1.20:6768' }
    ])
  })

  it('recognises a Tailscale address in that fallback', () => {
    expect(hostConnectionPathTargets({ endpoint: 'ws://desk.tail1234.ts.net:6768' })[0]!.kind).toBe(
      'tailscale'
    )
  })
})

describe('summarizeHostConnectionPaths', () => {
  it('passes when only the relay answers — the reported bug', () => {
    const result = summarizeHostConnectionPaths([
      { kind: 'lan', url: 'ws://192.168.1.20:6768', reachable: false },
      { kind: 'relay', url: 'wss://relay.manta.sh.cn/v1/connect/x', reachable: true }
    ])
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('relay')
  })

  it('names every path that answered', () => {
    const result = summarizeHostConnectionPaths([
      { kind: 'lan', url: 'ws://192.168.1.20:6768', reachable: true },
      { kind: 'relay', url: 'wss://relay.manta.sh.cn/v1/connect/x', reachable: true }
    ])
    expect(result.detail).toContain('LAN')
    expect(result.detail).toContain('relay')
  })

  it('keeps the Tailscale hint when nothing answered', () => {
    const result = summarizeHostConnectionPaths([
      { kind: 'tailscale', url: 'ws://desk.tail1234.ts.net:6768', reachable: false }
    ])
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('Tailscale')
  })

  // Kept from the retired unreachableHostDetail: which addresses count as
  // Tailscale, and therefore earn the "toggle the tunnel" hint.
  it.each([
    ['ws://100.65.9.106:6768', '100.65.9.106:6768'],
    ['ws://my-desktop.tailnet-1234.ts.net:6768', 'my-desktop.tailnet-1234.ts.net:6768']
  ])('points at Tailscale for %s', (url, shown) => {
    const result = summarizeHostConnectionPaths([{ kind: 'tailscale', url, reachable: false }])
    expect(result.detail).toBe(`Cannot reach ${shown} — check Tailscale`)
  })

  it.each(['ws://192.168.1.50:6768', 'ws://100.20.1.5:6768'])(
    'stays generic for the non-Tailscale address %s',
    (url) => {
      const result = summarizeHostConnectionPaths([
        { kind: hostConnectionPathTargets({ endpoint: url })[0]!.kind, url, reachable: false }
      ])
      expect(result.detail).not.toContain('Tailscale')
    }
  )

  it('fails without a Tailscale hint for a plain LAN host', () => {
    const result = summarizeHostConnectionPaths([
      { kind: 'lan', url: 'ws://192.168.1.20:6768', reachable: false }
    ])
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('192.168.1.20')
    expect(result.detail).not.toContain('Tailscale')
  })
})
