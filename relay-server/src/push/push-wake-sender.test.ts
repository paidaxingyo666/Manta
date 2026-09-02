import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPushWakeSender } from './push-wake-sender.js'

const dir = mkdtempSync(join(tmpdir(), 'apns-wire-'))
const keyPath = join(dir, 'AuthKey.p8')
writeFileSync(
  keyPath,
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
)

const logger = () => ({ info: vi.fn() })

afterEach(() => {
  for (const name of [
    'MANTA_RELAY_APNS_KEY_PATH',
    'MANTA_RELAY_APNS_KEY_ID',
    'MANTA_RELAY_APNS_TEAM_ID',
    'MANTA_RELAY_APNS_TOPIC'
  ]) {
    delete process.env[name]
  }
})

function configure(): void {
  process.env.MANTA_RELAY_APNS_KEY_PATH = keyPath
  process.env.MANTA_RELAY_APNS_KEY_ID = '7PW8NS77TJ'
  process.env.MANTA_RELAY_APNS_TEAM_ID = 'G5J7URYYG5'
  process.env.MANTA_RELAY_APNS_TOPIC = 'cn.sh.manta.mobile'
}

describe('createPushWakeSender', () => {
  it('is absent and says so when push is not configured', () => {
    const log = logger()

    expect(createPushWakeSender(log)).toBeNull()
    expect(log.info).toHaveBeenCalledWith('apns.disabled', expect.anything())
  })

  it('builds a sender and logs what it will talk to', () => {
    configure()
    const log = logger()

    expect(createPushWakeSender(log)).toBeTypeOf('function')
    expect(log.info).toHaveBeenCalledWith(
      'apns.ready',
      expect.objectContaining({ topic: 'cn.sh.manta.mobile', keyId: '7PW8NS77TJ' })
    )
  })

  // The whole point of resolving at boot: a Sandbox-only key or a bad path is a
  // configuration mistake, and it should stop the relay next to the rest of its
  // settings rather than surface hours later as a dropped notification.
  it('refuses to boot on a partial configuration', () => {
    configure()
    delete process.env.MANTA_RELAY_APNS_TEAM_ID

    expect(() => createPushWakeSender(logger())).toThrow(/MANTA_RELAY_APNS_TEAM_ID/)
  })

  it('never logs the key itself', () => {
    configure()
    const log = logger()
    createPushWakeSender(log)

    const logged = JSON.stringify(log.info.mock.calls)
    expect(logged).not.toContain('BEGIN PRIVATE KEY')
    expect(logged).not.toContain('MII')
  })
})
