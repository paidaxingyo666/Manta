/**
 * Bad configuration must fail at startup.
 *
 * An out-of-range value does not fail loudly on the wire — the client's strict
 * schema just drops the whole message — so the symptom is "pairing silently
 * stopped working", which is the worst possible thing to debug remotely.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const saved = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MANTA_RELAY_')) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, saved)
})

function withEnv(overrides: Record<string, string>): void {
  process.env.MANTA_RELAY_PUBLIC_URL = 'https://relay.example.com'
  process.env.MANTA_RELAY_TOKEN_SECRET = 'secret'
  process.env.MANTA_RELAY_ENROLLMENT_SECRET = 'enrol'
  Object.assign(process.env, overrides)
}

describe('loadConfig', () => {
  it('requires a public origin', () => {
    delete process.env.MANTA_RELAY_PUBLIC_URL
    expect(() => loadConfig()).toThrow(/MANTA_RELAY_PUBLIC_URL is required/)
  })

  it('refuses an origin carrying a path', () => {
    withEnv({ MANTA_RELAY_PUBLIC_URL: 'https://relay.example.com/relay' })
    expect(() => loadConfig()).toThrow(/bare origin/)
  })

  it('refuses credential windows shorter than the phone rotation window', () => {
    // The phone starts rotating 7 days before expiry; a shorter window means
    // credentials lapse mid-rotation and every phone silently unpairs.
    withEnv({ MANTA_RELAY_RESUME_TTL_MS: String(5 * 24 * 60 * 60_000) })
    expect(() => loadConfig()).toThrow(/RESUME_TTL_MS must exceed 14 days/)
  })

  it('refuses an attach deadline the client would never wait for', () => {
    withEnv({ MANTA_RELAY_ATTACH_DEADLINE_MS: '120000' })
    expect(() => loadConfig()).toThrow(/ATTACH_DEADLINE_MS/)
  })

  it('refuses an unknown log level', () => {
    withEnv({ MANTA_RELAY_LOG_LEVEL: 'chatty' })
    expect(() => loadConfig()).toThrow(/LOG_LEVEL/)
  })

  it('flags an ephemeral token secret rather than failing', () => {
    // Refusing to start would be worse: a first-run operator would just see a
    // crash. The warning is emitted by main against this flag.
    withEnv({})
    delete process.env.MANTA_RELAY_TOKEN_SECRET
    expect(loadConfig().ephemeralSecret).toBe(true)
  })

  it('defaults to trusting no proxy', () => {
    withEnv({})
    expect(loadConfig().trustedProxies).toBe('')
  })

  it('refuses a malformed trusted-proxy list at startup', () => {
    // Otherwise the first request is where it fails, by which point the relay
    // has already told a supervisor it started successfully.
    withEnv({ MANTA_RELAY_TRUSTED_PROXIES: '10.0.0.0/99' })
    expect(() => loadConfig()).toThrow(/TRUSTED_PROXIES/)
  })

  it('refuses more connections per host than the desktop schema admits', () => {
    withEnv({ MANTA_RELAY_MAX_CONNS_PER_HOST: '32' })
    expect(() => loadConfig()).toThrow(/MAX_CONNS_PER_HOST/)
  })

  it('refuses a drain window the drain frame could not carry', () => {
    withEnv({ MANTA_RELAY_SHUTDOWN_GRACE_MS: '7200000' })
    expect(() => loadConfig()).toThrow(/SHUTDOWN_GRACE_MS/)
  })

  it('refuses to expose an open enrolment endpoint on a public origin', () => {
    // /authorize grants a session to whoever asks. On loopback that is the
    // local user; on a public origin it is the internet.
    withEnv({})
    delete process.env.MANTA_RELAY_ENROLLMENT_SECRET
    expect(() => loadConfig()).toThrow(/ENROLLMENT_SECRET is required/)
  })

  it('allows a loopback deployment without an enrolment secret', () => {
    withEnv({ MANTA_RELAY_PUBLIC_URL: 'http://127.0.0.1:8787' })
    delete process.env.MANTA_RELAY_ENROLLMENT_SECRET
    expect(loadConfig().enrollmentSecret).toBeNull()
  })

  it('serves one shared identity unless told otherwise', () => {
    // The default has to stay what every relay deployed before accounts is,
    // or an upgrade turns into a lockout on restart.
    withEnv({})
    expect(loadConfig().accountsMode).toBe('shared')
  })

  it('takes per-user only from the value that means it', () => {
    withEnv({ MANTA_RELAY_ACCOUNTS: ' Per-User ' })
    expect(loadConfig().accountsMode).toBe('per-user')
    withEnv({ MANTA_RELAY_ACCOUNTS: 'yes' })
    expect(loadConfig().accountsMode).toBe('shared')
  })

  it('refuses per-user accounts on a token secret that changes every restart', () => {
    // Every account is signed out on each deploy, and deploying is how this
    // relay is updated.
    withEnv({ MANTA_RELAY_ACCOUNTS: 'per-user' })
    delete process.env.MANTA_RELAY_TOKEN_SECRET
    expect(() => loadConfig()).toThrow(/TOKEN_SECRET is required/)
  })

  it('refuses a per-user relay nobody could ever sign in to', () => {
    withEnv({ MANTA_RELAY_ACCOUNTS: 'per-user', MANTA_RELAY_ALLOW_REGISTRATION: 'disabled' })
    expect(() => loadConfig()).toThrow(/no one could sign in/)
  })

  it('accepts a complete configuration', () => {
    withEnv({
      MANTA_RELAY_TRUSTED_PROXIES: 'loopback,private',
      MANTA_RELAY_METRICS_TOKEN: 'm',
      MANTA_RELAY_MAX_DEVICES: '32'
    })
    const config = loadConfig()
    expect(config).toMatchObject({
      publicUrl: 'https://relay.example.com',
      maxDevicesPerHost: 32,
      metricsToken: 'm',
      ephemeralSecret: false
    })
  })
})
