import { describe, expect, it, vi } from 'vitest'
import { startDiagnosticFetchTimeout } from './diagnostic-fetch-timeout'
import {
  INTERNET_PROBE_URLS,
  probeHostName,
  testInternetReachability
} from './internet-reachability'

const URLS = ['https://a.example/x', 'https://b.example/x'] as const

function fetchStub(byUrl: Record<string, 'ok' | 'not-ok' | 'throw'>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const outcome = byUrl[String(input)]
    if (outcome === 'throw' || outcome === undefined) {
      throw new Error('network')
    }
    return { ok: outcome === 'ok' } as Response
  }) as unknown as typeof fetch
}

describe('testInternetReachability', () => {
  it('reports online when any probe answers — the mainland-China case', async () => {
    // dns.google is blocked there; a single-probe check called a working
    // connection "No connection".
    const timeout = startDiagnosticFetchTimeout(1000)
    const result = await testInternetReachability(
      timeout,
      URLS,
      fetchStub({ 'https://a.example/x': 'throw', 'https://b.example/x': 'ok' })
    )
    timeout.dispose()
    expect(result).toEqual({ status: 'online', via: 'https://b.example/x' })
  })

  it('reports offline only when every probe fails', async () => {
    const timeout = startDiagnosticFetchTimeout(1000)
    const result = await testInternetReachability(
      timeout,
      URLS,
      fetchStub({ 'https://a.example/x': 'throw', 'https://b.example/x': 'throw' })
    )
    timeout.dispose()
    expect(result).toEqual({ status: 'offline' })
  })

  it('distinguishes a captive portal from having no network', async () => {
    const timeout = startDiagnosticFetchTimeout(1000)
    const result = await testInternetReachability(
      timeout,
      URLS,
      fetchStub({ 'https://a.example/x': 'not-ok', 'https://b.example/x': 'throw' })
    )
    timeout.dispose()
    expect(result.status).toBe('unexpected-response')
  })

  it('stops probing when the caller aborts', async () => {
    const timeout = startDiagnosticFetchTimeout(1000)
    const seen: (AbortSignal | undefined)[] = []
    const spy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined)
      return { ok: true } as Response
    })
    await testInternetReachability(timeout, URLS, spy as unknown as typeof fetch)
    timeout.dispose()
    expect(seen).toHaveLength(URLS.length)
    expect(seen.every((signal) => signal === timeout.signal)).toBe(true)
  })

  it('spans more than one operator so a single blockade cannot fail the check', () => {
    const hosts = new Set(INTERNET_PROBE_URLS.map(probeHostName))
    expect(hosts.size).toBeGreaterThanOrEqual(3)
  })
})
