/**
 * Hostname and IPv4 validation for a typed-in host address.
 *
 * Split from host-endpoint so the URL-shaping path there reads as one flow.
 * These answer a narrower question — is this string a host we can dial — and
 * carry the numeric-IPv4 rules that make it fiddly.
 */
const NUMERIC_IPV4_CANDIDATE = /^(?:0[xX][0-9a-fA-F]+|\d+)(?:\.(?:0[xX][0-9a-fA-F]+|\d+))*$/

export function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

/**
 * Reject hostnames that would be illegal or ambiguous in a websocket URL.
 * Allows DNS labels, `.local` mDNS, IPv4, and IPv6 hex forms.
 */
export function validateHostname(host: string): string | null {
  if (!host) {
    return 'Missing hostname.'
  }
  // Spaces, path/query/fragment separators, userinfo separators, brackets.
  if (/[\s/?#@[\]]/.test(host)) {
    return 'Not a valid hostname.'
  }
  const numericIpv4Error = validateNumericIpv4Candidate(host)
  if (numericIpv4Error) {
    return numericIpv4Error
  }
  if (host.includes(':')) {
    // Why: a hex/colon regex accepts malformed forms such as two `::` runs.
    // Reuse the URL parser that WebSocket will ultimately use.
    if (!/^[0-9a-fA-F:]+$/.test(host)) {
      return 'Not a valid hostname.'
    }
    try {
      // Any port parses; this one only completes the URL so the parser runs.
      new URL(`ws://[${host}]:1`)
    } catch {
      return 'Not a valid hostname.'
    }
    return null
  }
  // DNS / IPv4 / mDNS: labels of alnum and hyphen, dots between, no empty labels.
  if (
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
      host
    )
  ) {
    return 'Not a valid hostname.'
  }
  return null
}

export function validateNumericIpv4Candidate(host: string): string | null {
  if (!NUMERIC_IPV4_CANDIDATE.test(host)) {
    return null
  }
  if (!isCanonicalIpv4(host)) {
    return 'Not a valid hostname.'
  }
  return null
}

export function normalizeRawNumericIpv4Candidate(host: string): string {
  let decoded = host
  try {
    decoded = decodeURIComponent(host)
  } catch {
    // The URL parser will reject malformed escapes; keep them untouched here.
  }
  return decoded.endsWith('.') ? decoded.slice(0, -1) : decoded
}

export function isCanonicalIpv4(host: string): boolean {
  const octets = host.split('.')
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  )
}

export function isValidPort(port: string): boolean {
  if (!/^\d+$/.test(port)) {
    return false
  }
  const n = Number(port)
  return n >= 1 && n <= 65535
}
