import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientAddress, normalizeAddress, parseTrustedProxies, rateLimitKey } from './client-ip.js'

function request(remote: string, forwarded?: string): IncomingMessage {
  return {
    socket: { remoteAddress: remote },
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded }
  } as unknown as IncomingMessage
}

describe('client address resolution', () => {
  it('ignores X-Forwarded-For from an untrusted peer', () => {
    // Honouring it unconditionally makes every rate limit decorative: a client
    // just sets a fresh value per request.
    const trusted = parseTrustedProxies('')
    expect(clientAddress(request('203.0.113.9', '198.51.100.1'), trusted)).toBe('203.0.113.9')
  })

  it('takes the first untrusted hop when the peer is a trusted proxy', () => {
    const trusted = parseTrustedProxies('loopback,private')
    expect(clientAddress(request('127.0.0.1', '198.51.100.1, 10.0.0.5'), trusted)).toBe(
      '198.51.100.1'
    )
  })

  it('does not walk past a spoofed prefix', () => {
    // Only the entry closest to our trusted edge is real; anything to its left
    // was written by the client.
    const trusted = parseTrustedProxies('loopback')
    expect(clientAddress(request('127.0.0.1', 'evil, 198.51.100.7'), trusted)).toBe('198.51.100.7')
  })

  it('falls back to the peer when the whole chain is trusted', () => {
    const trusted = parseTrustedProxies('private')
    expect(clientAddress(request('10.0.0.2', '10.0.0.3, 10.0.0.4'), trusted)).toBe('10.0.0.2')
  })

  it('understands CIDR and IPv6', () => {
    const trusted = parseTrustedProxies('172.18.0.0/16, ::1/128')
    expect(clientAddress(request('172.18.0.9', '203.0.113.4'), trusted)).toBe('203.0.113.4')
    expect(clientAddress(request('::1', '203.0.113.5'), trusted)).toBe('203.0.113.5')
    expect(clientAddress(request('172.19.0.9', '203.0.113.6'), trusted)).toBe('172.19.0.9')
  })

  it('rejects a malformed trusted-proxy list at startup rather than at runtime', () => {
    expect(() => parseTrustedProxies('not-an-ip')).toThrow(/not an IP/)
    expect(() => parseTrustedProxies('10.0.0.0/64')).toThrow(/prefix/)
  })

  it('unwraps IPv4-mapped IPv6 peers so buckets do not split', () => {
    expect(normalizeAddress('::ffff:203.0.113.1')).toBe('203.0.113.1')
    expect(normalizeAddress(undefined)).toBe('unknown')
  })
})

describe('rate-limit bucketing', () => {
  it('collapses an IPv6 subscriber to one bucket', () => {
    // A residential IPv6 allocation is a /64 or shorter, so bucketing on the
    // full address gives one subscriber billions of keys — enough to evade
    // their own limit and to fill the limiter's table, which then refuses new
    // keys and locks out everyone else.
    const a = rateLimitKey('2001:db8:1234:5678:1::1')
    const b = rateLimitKey('2001:db8:1234:5678:ffff:ffff:ffff:ffff')
    expect(a).toBe(b)
    expect(rateLimitKey('2001:db8:1234:9999::1')).not.toBe(a)
  })

  it('handles compressed and full forms identically', () => {
    expect(rateLimitKey('2001:db8::1')).toBe(rateLimitKey('2001:0db8:0:0:aaaa::9'))
    expect(rateLimitKey('::1')).toBe(rateLimitKey('0:0:0:0:1:2:3:4'))
  })

  it('leaves IPv4 addresses whole', () => {
    expect(rateLimitKey('203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitKey('unknown')).toBe('unknown')
  })
})
