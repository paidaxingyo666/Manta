import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadApnsConfig } from './apns-config.js'
import { APNS_PRODUCTION_HOST, APNS_SANDBOX_HOST } from './apns-sender.js'

const dir = mkdtempSync(join(tmpdir(), 'apns-'))
const keyPath = join(dir, 'AuthKey.p8')
writeFileSync(
  keyPath,
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
)

const FULL = {
  MANTA_RELAY_APNS_KEY_PATH: keyPath,
  MANTA_RELAY_APNS_KEY_ID: '7PW8NS77TJ',
  MANTA_RELAY_APNS_TEAM_ID: 'G5J7URYYG5',
  MANTA_RELAY_APNS_TOPIC: 'cn.sh.manta.mobile'
}

describe('loadApnsConfig', () => {
  it('is absent when nothing is configured — push is opt-in', () => {
    expect(loadApnsConfig({})).toBeNull()
  })

  it('loads a complete configuration', () => {
    const config = loadApnsConfig(FULL)

    expect(config?.topic).toBe('cn.sh.manta.mobile')
    expect(config?.credentials.keyId).toBe('7PW8NS77TJ')
    expect(config?.credentials.privateKey).toContain('BEGIN PRIVATE KEY')
  })

  /**
   * The failure this test exists for: one misspelled variable becomes a relay
   * that starts fine and never pushes, and nothing anywhere says why.
   */
  it.each([
    ['MANTA_RELAY_APNS_KEY_PATH'],
    ['MANTA_RELAY_APNS_KEY_ID'],
    ['MANTA_RELAY_APNS_TEAM_ID'],
    ['MANTA_RELAY_APNS_TOPIC']
  ])('refuses to start with %s missing rather than silently disabling push', (name) => {
    const partial = { ...FULL }
    delete (partial as Record<string, string>)[name]

    expect(() => loadApnsConfig(partial)).toThrow(new RegExp(name))
  })

  // TestFlight and the App Store use production. Defaulting to sandbox would
  // mean push works in development and silently never works in the field.
  it('defaults to the production host', () => {
    expect(loadApnsConfig(FULL)?.host).toBe(APNS_PRODUCTION_HOST)
  })

  it('honours an explicit sandbox environment', () => {
    expect(loadApnsConfig({ ...FULL, MANTA_RELAY_APNS_ENVIRONMENT: 'sandbox' })?.host).toBe(
      APNS_SANDBOX_HOST
    )
  })

  it('refuses an environment that is neither', () => {
    expect(() => loadApnsConfig({ ...FULL, MANTA_RELAY_APNS_ENVIRONMENT: 'prod' })).toThrow(
      /production.*sandbox/
    )
  })

  it.each([
    ['MANTA_RELAY_APNS_KEY_ID', 'too-short'],
    ['MANTA_RELAY_APNS_TEAM_ID', 'g5j7uryyg5'],
    ['MANTA_RELAY_APNS_KEY_ID', '7PW8NS77TJX']
  ])('rejects a malformed %s', (name, value) => {
    expect(() => loadApnsConfig({ ...FULL, [name]: value })).toThrow(new RegExp(name))
  })

  // The container runs as a non-root user, so a key that is readable on the
  // host is routinely unreadable through the bind mount.
  it('says what to check when the key cannot be read', () => {
    expect(() =>
      loadApnsConfig({ ...FULL, MANTA_RELAY_APNS_KEY_PATH: join(dir, 'missing.p8') })
    ).toThrow(/non-root user/)
  })

  it('rejects a file that is not a PEM key', () => {
    const bogus = join(dir, 'bogus.p8')
    writeFileSync(bogus, 'not a key')

    expect(() => loadApnsConfig({ ...FULL, MANTA_RELAY_APNS_KEY_PATH: bogus })).toThrow(/PEM/)
  })
})
