import { describe, expect, it } from 'vitest'
import {
  bindHostIsNetworkExposed,
  describeMantadBindExposure,
  MANTAD_LOOPBACK_BIND_HOST,
  MantadBindAddressError,
  resolveMantadBindHost
} from './mantad-bind-address'

describe('resolveMantadBindHost', () => {
  it('defaults to loopback when the operator asked for nothing', () => {
    expect(resolveMantadBindHost()).toBe(MANTAD_LOOPBACK_BIND_HOST)
    expect(MANTAD_LOOPBACK_BIND_HOST).toBe('127.0.0.1')
  })

  it('accepts literal IPv4 and IPv6 addresses, including explicit wide binds', () => {
    expect(resolveMantadBindHost('0.0.0.0')).toBe('0.0.0.0')
    expect(resolveMantadBindHost('10.1.2.3')).toBe('10.1.2.3')
    expect(resolveMantadBindHost('::1')).toBe('::1')
    expect(resolveMantadBindHost('localhost')).toBe('127.0.0.1')
    expect(resolveMantadBindHost(' 127.0.0.1 ')).toBe('127.0.0.1')
  })

  it('refuses hostnames, because DNS would decide which interface got bound', () => {
    expect(() => resolveMantadBindHost('internal.example')).toThrow(MantadBindAddressError)
    expect(() => resolveMantadBindHost('')).toThrow(MantadBindAddressError)
    expect(() => resolveMantadBindHost('0.0.0.0:80')).toThrow(MantadBindAddressError)
  })
})

describe('bindHostIsNetworkExposed', () => {
  it('separates local-only addresses from network-reachable ones', () => {
    expect(bindHostIsNetworkExposed('127.0.0.1')).toBe(false)
    expect(bindHostIsNetworkExposed('127.5.5.5')).toBe(false)
    expect(bindHostIsNetworkExposed('::1')).toBe(false)
    expect(bindHostIsNetworkExposed('0.0.0.0')).toBe(true)
    expect(bindHostIsNetworkExposed('::')).toBe(true)
    expect(bindHostIsNetworkExposed('10.1.2.3')).toBe(true)
  })

  it('says out loud when a deployment is reachable from the network', () => {
    expect(describeMantadBindExposure('0.0.0.0')).toContain('reachable from the network')
    expect(describeMantadBindExposure('127.0.0.1')).toContain('local only')
  })
})
