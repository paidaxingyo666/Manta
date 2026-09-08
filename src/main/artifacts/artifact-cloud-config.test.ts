import { afterEach, describe, expect, it } from 'vitest'
import {
  resetMantaCloudEndpointOverrideSourceForTests,
  setMantaCloudEndpointOverrideSource
} from '../manta-profiles/profile-cloud-auth-config'
import {
  allowsArtifactCloudAuthOverride,
  resolveArtifactCloudApiUrl
} from './artifact-cloud-config'

const DEV = { NODE_ENV: 'development' }

describe('resolveArtifactCloudApiUrl', () => {
  it('uses the first-party production origin by default', () => {
    expect(resolveArtifactCloudApiUrl(undefined, {}, true)).toBe('https://share.manta.sh.cn')
  })

  it('lets the operator name their own host', () => {
    expect(
      resolveArtifactCloudApiUrl(
        undefined,
        { MANTA_ARTIFACTS_API_URL: 'https://artifacts.example.com' },
        true
      )
    ).toBe('https://artifacts.example.com')
  })

  it('accepts a per-call override that agrees with the configured host', () => {
    expect(
      resolveArtifactCloudApiUrl(
        'https://artifacts.example.com',
        { MANTA_ARTIFACTS_API_URL: 'https://artifacts.example.com' },
        true
      )
    ).toBe('https://artifacts.example.com')
  })

  // `apiUrl` rides on every artifacts RPC method and on `manta artifacts
  // --api-url`, while the bearer token comes from the stored session. Without
  // this, one command in a Manta terminal walks the token off the machine.
  it('refuses a packaged-build override that points somewhere else', () => {
    expect(() =>
      resolveArtifactCloudApiUrl(
        'https://attacker.example',
        { MANTA_ARTIFACTS_API_URL: 'https://artifacts.example.com' },
        true
      )
    ).toThrow(/only in development builds/)
    expect(() => resolveArtifactCloudApiUrl('https://attacker.example', {}, true)).toThrow(
      /only in development builds/
    )
  })

  it('still allows a free-form override in development', () => {
    expect(resolveArtifactCloudApiUrl('http://127.0.0.1:45961', DEV, false)).toBe(
      'http://127.0.0.1:45961'
    )
    expect(resolveArtifactCloudApiUrl('https://staging.example.com', DEV, false)).toBe(
      'https://staging.example.com'
    )
  })

  it('allows loopback HTTP only outside a packaged build', () => {
    expect(
      resolveArtifactCloudApiUrl(
        undefined,
        { ...DEV, MANTA_ARTIFACTS_API_URL: 'http://127.0.0.1:45961' },
        false
      )
    ).toBe('http://127.0.0.1:45961')
    expect(() => resolveArtifactCloudApiUrl('http://127.0.0.1:45961', {}, true)).toThrow(/HTTPS/)
  })

  // The token travels on this origin; plain HTTP would put it on the wire.
  it('refuses plain HTTP to a remote host', () => {
    expect(() =>
      resolveArtifactCloudApiUrl(undefined, { MANTA_ARTIFACTS_API_URL: 'http://a.example' }, false)
    ).toThrow(/HTTPS/)
  })

  it('refuses anything that is not a bare origin, configured or overridden', () => {
    expect(() =>
      resolveArtifactCloudApiUrl(
        undefined,
        { MANTA_ARTIFACTS_API_URL: 'https://a.example/x' },
        true
      )
    ).toThrow(/origin/)
    expect(() => resolveArtifactCloudApiUrl('https://a.example?t=1', DEV, false)).toThrow(/origin/)
    expect(() => resolveArtifactCloudApiUrl('https://u:p@a.example', DEV, false)).toThrow(/origin/)
  })
})

describe('allowsArtifactCloudAuthOverride', () => {
  it('is off in production and in packaged builds', () => {
    expect(allowsArtifactCloudAuthOverride({ NODE_ENV: 'production' }, false)).toBe(false)
    expect(allowsArtifactCloudAuthOverride(DEV, true)).toBe(false)
    expect(allowsArtifactCloudAuthOverride(DEV, false)).toBe(true)
  })
})

describe('resolveArtifactCloudApiUrl with a configured artifact host', () => {
  afterEach(() => {
    resetMantaCloudEndpointOverrideSourceForTests()
  })

  it('prefers the settings field over the environment variable', () => {
    // The variable only reaches a build launched from a shell; a packaged app
    // started from the Dock inherits none, which is why the field outranks it.
    setMantaCloudEndpointOverrideSource(() => ({ artifactsBaseUrl: 'https://share.example.com' }))
    expect(
      resolveArtifactCloudApiUrl(undefined, { MANTA_ARTIFACTS_API_URL: 'https://env.example' }, true)
    ).toBe('https://share.example.com')
  })

  it('falls back to the variable, then the built-in host, as the field empties', () => {
    setMantaCloudEndpointOverrideSource(() => ({}))
    expect(
      resolveArtifactCloudApiUrl(undefined, { MANTA_ARTIFACTS_API_URL: 'https://env.example' }, true)
    ).toBe('https://env.example')
    expect(resolveArtifactCloudApiUrl(undefined, {}, true)).toBe('https://share.manta.sh.cn')
  })

  it('makes the configured host the allow-list a per-call override must match', () => {
    // The point of the allow-list: apiUrl is a per-call parameter reachable from
    // anything that can run one command, while the bearer comes from the stored
    // session. A field-configured host must bind it just as the variable does.
    setMantaCloudEndpointOverrideSource(() => ({ artifactsBaseUrl: 'https://share.example.com' }))
    expect(resolveArtifactCloudApiUrl('https://share.example.com', {}, true)).toBe(
      'https://share.example.com'
    )
    expect(() => resolveArtifactCloudApiUrl('https://evil.example', {}, true)).toThrow(
      /only in development/
    )
  })

  it('survives a reader that throws rather than making publishing unusable', () => {
    setMantaCloudEndpointOverrideSource(() => {
      throw new Error('settings unreadable')
    })
    expect(resolveArtifactCloudApiUrl(undefined, {}, true)).toBe('https://share.manta.sh.cn')
  })
})
