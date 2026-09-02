/**
 * Client address resolution behind a reverse proxy.
 *
 * Rate limiting is only as good as the key it buckets on. If X-Forwarded-For is
 * trusted unconditionally, any client can spoof it and every limit becomes
 * decorative; if it is ignored, a proxied deployment buckets the whole internet
 * under the proxy's address and one phone can lock out everyone. So the header
 * is honoured only for peers inside an explicitly configured trusted range.
 */
import { BlockList, isIPv4, isIPv6 } from 'node:net'
import type { IncomingMessage } from 'node:http'

export type TrustedProxies = {
  /** True when the direct peer is allowed to speak for someone else. */
  trusts: (address: string) => boolean
}

/** Shorthands an operator can use instead of spelling out RFC1918 by hand. */
const ALIASES: Record<string, string[]> = {
  loopback: ['127.0.0.0/8', '::1/128'],
  private: [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16',
    'fc00::/7',
    'fe80::/10'
  ],
  // Docker bridge networks land in 172.16/12, which `private` already covers.
  docker: ['172.16.0.0/12']
}

export function parseTrustedProxies(spec: string): TrustedProxies {
  const list = new BlockList()
  let count = 0
  for (const raw of spec
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const entries = ALIASES[raw.toLowerCase()] ?? [raw]
    for (const entry of entries) {
      const slash = entry.indexOf('/')
      const address = slash === -1 ? entry : entry.slice(0, slash)
      const prefix = slash === -1 ? undefined : entry.slice(slash + 1)
      const type = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null
      if (!type) {
        throw new Error(`MANTA_RELAY_TRUSTED_PROXIES: not an IP or CIDR: ${entry}`)
      }
      if (prefix === undefined) {
        list.addAddress(address, type)
      } else {
        const bits = Number(prefix)
        const max = type === 'ipv4' ? 32 : 128
        if (!Number.isInteger(bits) || bits < 0 || bits > max) {
          throw new Error(`MANTA_RELAY_TRUSTED_PROXIES: bad prefix length in ${entry}`)
        }
        list.addSubnet(address, bits, type)
      }
      count += 1
    }
  }
  if (count === 0) {
    return { trusts: () => false }
  }
  return {
    trusts: (address) => {
      const type = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null
      return type ? list.check(address, type) : false
    }
  }
}

/**
 * The key a rate limiter should bucket on.
 *
 * A single residential IPv6 allocation is a /64 or shorter, so bucketing on the
 * full address lets one subscriber present billions of distinct keys — which
 * both evades their own limit and fills the limiter's table, at which point new
 * keys are refused and legitimate clients are locked out. IPv4 has no such
 * problem and is used whole.
 */
export function rateLimitKey(address: string): string {
  if (!isIPv6(address) || address.includes('.')) {
    return address
  }
  const groups = expandIPv6(address)
  if (!groups) {
    return address
  }
  // Normalize each group: `2001:0db8:…` and `2001:db8:…` are the same network,
  // and a forwarded header may be written either way. Two spellings of one
  // prefix would otherwise be two buckets, which is exactly the split the
  // aggregation exists to prevent.
  return `${groups
    .slice(0, 4)
    .map((group) => (group.replace(/^0+/, '') || '0').toLowerCase())
    .join(':')}::/64`
}

/** Expands an IPv6 address to its eight groups, or null if unparseable. */
function expandIPv6(address: string): string[] | null {
  const [head, tail] = address.split('::')
  if (head === undefined) {
    return null
  }
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  if (tail === undefined) {
    return left.length === 8 ? left : null
  }
  const missing = 8 - left.length - right.length
  if (missing < 0) {
    return null
  }
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right]
}

/** Strips the `::ffff:` prefix Node puts on IPv4 peers of a dual-stack socket. */
export function normalizeAddress(address: string | undefined): string {
  if (!address) {
    return 'unknown'
  }
  return address.startsWith('::ffff:') && isIPv4(address.slice(7)) ? address.slice(7) : address
}

/**
 * The address to bucket this request under.
 *
 * Only the entry closest to our trusted edge is taken — walking further left
 * would re-admit the spoofable part of the header.
 */
export function clientAddress(request: IncomingMessage, trusted: TrustedProxies): string {
  const peer = normalizeAddress(request.socket.remoteAddress ?? undefined)
  if (!trusted.trusts(peer)) {
    return peer
  }
  const header = request.headers['x-forwarded-for']
  const chain = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = normalizeAddress(chain[index] ?? undefined)
    if (!trusted.trusts(candidate)) {
      return candidate
    }
  }
  return peer
}
