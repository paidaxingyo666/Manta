import { describe, expect, it } from 'vitest'
import {
  mantaCloudEndpointsArePaired,
  normalizeMantaCloudClientId,
  normalizeMantaCloudEndpointOverrides,
  normalizeMantaCloudEndpointUrl,
  normalizeMantaCloudOrigin
} from './manta-cloud-endpoints'

describe('normalizeMantaCloudEndpointUrl', () => {
  it('treats an empty value as "use the built-in endpoint"', () => {
    expect(normalizeMantaCloudEndpointUrl('')).toEqual({ ok: true, value: '' })
    expect(normalizeMantaCloudEndpointUrl('   ')).toEqual({ ok: true, value: '' })
    expect(normalizeMantaCloudEndpointUrl(undefined)).toEqual({ ok: true, value: '' })
  })

  it('requires https and strips a trailing slash', () => {
    expect(normalizeMantaCloudEndpointUrl('https://login.example.com/')).toEqual({
      ok: true,
      value: 'https://login.example.com'
    })
    expect(normalizeMantaCloudEndpointUrl('http://login.example.com').ok).toBe(false)
  })

  it('allows loopback http only when explicitly permitted', () => {
    expect(normalizeMantaCloudEndpointUrl('http://127.0.0.1:8080').ok).toBe(false)
    expect(
      normalizeMantaCloudEndpointUrl('http://127.0.0.1:8080', { allowLoopbackHttp: true })
    ).toEqual({ ok: true, value: 'http://127.0.0.1:8080' })
  })

  it('rejects malformed input', () => {
    expect(normalizeMantaCloudEndpointUrl('not a url').ok).toBe(false)
    expect(normalizeMantaCloudEndpointUrl(`https://x.example.com/${'a'.repeat(2100)}`).ok).toBe(
      false
    )
  })
})

describe('normalizeMantaCloudOrigin', () => {
  it('accepts a bare origin', () => {
    expect(normalizeMantaCloudOrigin('https://relay.example.com')).toEqual({
      ok: true,
      value: 'https://relay.example.com'
    })
  })

  it('rejects anything carrying a path, query, or hash', () => {
    // Why: the runtime silently discards a non-canonical origin and falls back
    // to the official relay, which would look like "my setting did nothing".
    expect(normalizeMantaCloudOrigin('https://relay.example.com/v1').ok).toBe(false)
    expect(normalizeMantaCloudOrigin('https://relay.example.com/?a=1').ok).toBe(false)
    expect(normalizeMantaCloudOrigin('https://relay.example.com/#x').ok).toBe(false)
  })
})

describe('normalizeMantaCloudClientId', () => {
  it('accepts safe identifiers and rejects the rest', () => {
    expect(normalizeMantaCloudClientId(' manta-desktop ')).toEqual({
      ok: true,
      value: 'manta-desktop'
    })
    expect(normalizeMantaCloudClientId('bad id!').ok).toBe(false)
    expect(normalizeMantaCloudClientId('x'.repeat(300)).ok).toBe(false)
  })
})

describe('mantaCloudEndpointsArePaired', () => {
  it('requires the sign-in server and relay to be set together', () => {
    expect(mantaCloudEndpointsArePaired(null)).toBe(true)
    expect(mantaCloudEndpointsArePaired({})).toBe(true)
    expect(
      mantaCloudEndpointsArePaired({
        apiBaseUrl: 'https://login.example.com',
        relayDirectorUrl: 'https://relay.example.com'
      })
    ).toBe(true)
    expect(mantaCloudEndpointsArePaired({ apiBaseUrl: 'https://login.example.com' })).toBe(false)
    expect(mantaCloudEndpointsArePaired({ relayDirectorUrl: 'https://relay.example.com' })).toBe(
      false
    )
  })
})

describe('normalizeMantaCloudEndpointOverrides', () => {
  it('drops invalid fields and returns undefined when nothing survives', () => {
    expect(normalizeMantaCloudEndpointOverrides(null)).toBeUndefined()
    expect(normalizeMantaCloudEndpointOverrides({ apiBaseUrl: 'http://nope.example.com' })).toBe(
      undefined
    )
    expect(
      normalizeMantaCloudEndpointOverrides({
        apiBaseUrl: 'https://login.example.com/',
        relayDirectorUrl: 'https://relay.example.com',
        clientId: 'manta-desktop',
        unknownField: 'ignored'
      })
    ).toEqual({
      apiBaseUrl: 'https://login.example.com',
      relayDirectorUrl: 'https://relay.example.com',
      clientId: 'manta-desktop'
    })
  })

  it('keeps a valid field even when a sibling is invalid', () => {
    expect(
      normalizeMantaCloudEndpointOverrides({
        apiBaseUrl: 'https://login.example.com',
        relayDirectorUrl: 'https://relay.example.com/has/path'
      })
    ).toEqual({ apiBaseUrl: 'https://login.example.com' })
  })
})
