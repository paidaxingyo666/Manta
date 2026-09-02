import type { DiagnosticFetchTimeout } from './diagnostic-fetch-timeout'

/**
 * Probes for "is there internet at all".
 *
 * A single well-known host is not a network test — it is a test of that host.
 * `dns.google` is unreachable from mainland China, so a perfectly working
 * connection was reported as "No connection". These are raced instead: the
 * first success wins, and only a total sweep counts as offline.
 *
 * Each is a tiny, cache-hostile endpoint that answers without a body worth
 * parsing, and the set deliberately spans operators and jurisdictions.
 */
export const INTERNET_PROBE_URLS: readonly string[] = [
  'https://cloudflare-dns.com/dns-query?name=example.com&type=A',
  'https://dns.alidns.com/resolve?name=example.com&type=A',
  'https://dns.google/resolve?name=example.com&type=A'
]

export type InternetReachability =
  | { status: 'online'; via: string }
  | { status: 'unexpected-response'; via: string }
  | { status: 'offline' }

/**
 * Resolves as soon as one probe answers; falls back to the least-bad verdict
 * across all of them. A non-ok HTTP status still proves the network carried a
 * request, which is a different problem from having no connection — captive
 * portals land here.
 */
export async function testInternetReachability(
  // Owned by the caller: the screen has to be able to abort a run that
  // outlives it, which it cannot do for a timeout created in here.
  timeout: DiagnosticFetchTimeout,
  urls: readonly string[] = INTERNET_PROBE_URLS,
  fetchImpl: typeof fetch = fetch
): Promise<InternetReachability> {
  const results = await Promise.all(
    urls.map(async (url): Promise<InternetReachability> => {
      try {
        const response = await fetchImpl(url, {
          signal: timeout.signal,
          headers: { accept: 'application/dns-json' }
        })
        return response.ok
          ? { status: 'online', via: url }
          : { status: 'unexpected-response', via: url }
      } catch {
        return { status: 'offline' }
      }
    })
  )
  return (
    results.find((result) => result.status === 'online') ??
    results.find((result) => result.status === 'unexpected-response') ?? { status: 'offline' }
  )
}

/** Host of a probe URL, so the result names what actually answered. */
export function probeHostName(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
