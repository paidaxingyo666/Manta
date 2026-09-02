import { describe, expect, it } from 'vitest'
import {
  deriveBrowserRoutePartition,
  deriveBrowserRoutePartitionStorageScope,
  isBrowserRoutePartition
} from './browser-route-identity'

const identity = {
  mantaProfileId: 'manta/profile:alpha',
  browserProfileId: 'browser/profile:default',
  authorityConnectionIdentity: 'paired/runtime:authority',
  executionHostIdentity: 'ssh/target:private.example'
}

/** Shipping-shaped inputs whose derived names are frozen: both are persisted on disk. */
const pinnedIdentity = {
  mantaProfileId: 'manta/profile:alpha',
  browserProfileId: 'browser/profile:default',
  authorityConnectionIdentity: 'paired-runtime:authority-a',
  executionHostIdentity: '["manta-browser-execution-host-storage",1,"authority","env-a"]'
}

describe('browser route partition identity', () => {
  it('derives a stable opaque cross-platform partition and binding fingerprint', () => {
    const first = deriveBrowserRoutePartition(identity)
    const second = deriveBrowserRoutePartition({ ...identity })

    expect(second).toEqual(first)
    expect(first.partition).toMatch(/^persist:manta-browser-v1-[a-f0-9]{64}$/)
    expect(first.bindingFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(first.partition.slice('persist:'.length)).toMatch(/^[a-z0-9-]+$/)
    for (const rawIdentity of Object.values(identity)) {
      expect(first.partition).not.toContain(rawIdentity)
    }
    expect(first.partition).not.toContain('private.example')
  })

  it('keeps delimiter-containing components structurally distinct', () => {
    const left = deriveBrowserRoutePartition({
      ...identity,
      mantaProfileId: 'a',
      browserProfileId: 'b:c'
    })
    const right = deriveBrowserRoutePartition({
      ...identity,
      mantaProfileId: 'a:b',
      browserProfileId: 'c'
    })

    expect(left).not.toEqual(right)
  })

  it('does not expose equality of individual identity components', () => {
    const baseline = deriveBrowserRoutePartition(identity).partition
    const sameProfile = deriveBrowserRoutePartition({
      ...identity,
      executionHostIdentity: 'ssh/target:other.example'
    }).partition

    expect(baseline.split('-').at(-1)).not.toBe(sameProfile.split('-').at(-1))
    expect(baseline).not.toMatch(/:[a-f0-9]{16}:/)
  })

  // Why: a component dropped from the hash silently merges two jars -- another browser
  // profile's or another paired server's cookies answer to this identity.
  it('makes every identity component load-bearing', () => {
    const derived = [
      identity,
      { ...identity, mantaProfileId: 'manta/profile:beta' },
      { ...identity, browserProfileId: 'browser/profile:work' },
      { ...identity, authorityConnectionIdentity: 'paired/runtime:other' },
      { ...identity, executionHostIdentity: 'ssh/target:other.example' }
    ].map((entry) => deriveBrowserRoutePartition(entry))

    expect(new Set(derived.map((entry) => entry.partition)).size).toBe(derived.length)
    expect(new Set(derived.map((entry) => entry.bindingFingerprint)).size).toBe(derived.length)
  })

  // Why: both names are persisted, so a changed hash input, order, tag, or version relocates
  // every existing user's cookie jar instead of failing.
  //
  // These differ from upstream's by exactly one thing: the component tag reads
  // `manta-profile` and the version prefix `manta-browser-v1`, where upstream
  // says orca. Free to change here only because this module arrived in the same
  // sync that renamed it — no build of this fork has ever written a partition
  // under the old name, so there is nothing to relocate. Anything that moves
  // them after this point does relocate real cookie jars.
  it('pins the derived partition and fingerprint against silent relocation', () => {
    expect(deriveBrowserRoutePartition(pinnedIdentity)).toEqual({
      partition:
        'persist:manta-browser-v1-e054b77296faa69b8da1acaaf2b3fbbc3dac3a2dc7f2d5a50ffda1e327126d2d',
      bindingFingerprint: 'fb75d2cc662fedd2a0ffdf5a149e117aa20068656b16dfd5ead92415ec2a87fa'
    })
  })

  it('keeps the partition name and the binding fingerprint in separate digest domains', () => {
    const derived = deriveBrowserRoutePartition(identity)

    expect(derived.partition).not.toContain(derived.bindingFingerprint)
  })

  // Why: removal deletes every partition carrying the scope, so a scope missing either
  // component wipes storage the removed record never owned.
  it('scopes partition ownership to one manta profile and one environment', () => {
    const scope = deriveBrowserRoutePartitionStorageScope({
      mantaProfileId: 'manta/profile:alpha',
      environmentId: 'environment-a'
    })

    expect(scope).toBe('805fa06af660887e3b788fa45f1b53a1351337b23796d592b14625c5c3317e13')
    expect(
      deriveBrowserRoutePartitionStorageScope({
        mantaProfileId: 'manta/profile:alpha',
        environmentId: 'environment-b'
      })
    ).not.toBe(scope)
    expect(
      deriveBrowserRoutePartitionStorageScope({
        mantaProfileId: 'manta/profile:beta',
        environmentId: 'environment-a'
      })
    ).not.toBe(scope)
  })

  // Why: an accepted name is joined onto the partition data root and that directory removed.
  it('recognizes a route partition only as a whole name', () => {
    const valid = deriveBrowserRoutePartition(pinnedIdentity).partition

    expect(isBrowserRoutePartition(valid)).toBe(true)
    for (const value of [
      `../../${valid}`,
      `${valid}/../../escape`,
      `${valid}extra`,
      valid.replace('persist:', '')
    ]) {
      expect(isBrowserRoutePartition(value)).toBe(false)
    }
  })

  it('rejects empty and unbounded identity components', () => {
    expect(() => deriveBrowserRoutePartition({ ...identity, executionHostIdentity: '' })).toThrow(
      'browser_route_partition_identity_invalid'
    )
    expect(() =>
      deriveBrowserRoutePartition({ ...identity, authorityConnectionIdentity: 'x'.repeat(513) })
    ).toThrow('browser_route_partition_identity_invalid')
    expect(() =>
      deriveBrowserRoutePartition({ ...identity, authorityConnectionIdentity: 'é'.repeat(257) })
    ).toThrow('browser_route_partition_identity_invalid')
    expect(() =>
      deriveBrowserRoutePartition({ ...identity, authorityConnectionIdentity: 'é'.repeat(256) })
    ).not.toThrow()
  })
})
