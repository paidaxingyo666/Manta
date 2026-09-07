import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PUSH_LIMITS } from '@manta-cloud/push-contract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PushDeviceRegistryStore } from './device-registry-store.js'
import { openPushDatabase, type PushDatabase } from './push-database.js'
import { PushSendQuota } from './send-quota.js'

// Cloud Verify supplies a disposable PostgreSQL; SQLite cannot expose these races.
const DATABASE_URL = process.env.ORCA_PUSH_TEST_DATABASE_URL
const CONCURRENT_RESERVES = 80

describe.skipIf(!DATABASE_URL)('push send quota on postgres', () => {
  let database: PushDatabase
  let hostFingerprint: string

  beforeEach(async () => {
    database = await openPushDatabase({
      databaseUrl: DATABASE_URL!,
      dataDir: tmpdir(),
      applicationName: 'orca-push-test'
    })
    // Every run owns a fresh identity, so a shared database needs no truncation.
    hostFingerprint = randomUUID().replaceAll('-', '').slice(0, 16)
  })

  afterEach(async () => {
    await database.query('DELETE FROM push_send_log WHERE host_fingerprint = ?', [hostFingerprint])
    await database.query('DELETE FROM push_devices WHERE host_fingerprint = ?', [hostFingerprint])
    await database.close()
  })

  it('admits exactly the hourly allowance when every reserve races at once', async () => {
    const quota = new PushSendQuota(database)
    const decisions = await Promise.all(
      Array.from({ length: CONCURRENT_RESERVES }, () => quota.reserve(hostFingerprint, 'reg-1'))
    )
    expect(decisions.filter((decision) => decision === 'allowed')).toHaveLength(
      PUSH_LIMITS.hostSendsPerRollingHour
    )
    expect(decisions.filter((decision) => decision === 'rate_limited')).toHaveLength(
      CONCURRENT_RESERVES - PUSH_LIMITS.hostSendsPerRollingHour
    )

    const [row] = await database.query(
      'SELECT COUNT(*) AS sends FROM push_send_log WHERE host_fingerprint = ?',
      [hostFingerprint]
    )
    expect(Number(row?.sends)).toBe(PUSH_LIMITS.hostSendsPerRollingHour)
  })

  it('holds the per-host device cap when every registration races at once', async () => {
    const devices = new PushDeviceRegistryStore(database)
    const attempts = PUSH_LIMITS.maxDevicesPerHost + 20
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, index) =>
        devices.upsert({
          hostFingerprint,
          deviceId: `device-${index}`,
          platform: 'android',
          token: `token-${index}`,
          filter: { sources: ['agent-task-complete'], agentStates: ['needs-input'] }
        })
      )
    )
    expect(results.filter((result) => result.ok)).toHaveLength(PUSH_LIMITS.maxDevicesPerHost)

    const [row] = await database.query(
      'SELECT COUNT(*) AS devices FROM push_devices WHERE host_fingerprint = ?',
      [hostFingerprint]
    )
    expect(Number(row?.devices)).toBe(PUSH_LIMITS.maxDevicesPerHost)
  })

  it('does not let one host lock block another host reserving at the same time', async () => {
    const quota = new PushSendQuota(database)
    const otherHost = randomUUID().replaceAll('-', '').slice(0, 16)
    try {
      const decisions = await Promise.all([
        ...Array.from({ length: 40 }, () => quota.reserve(hostFingerprint, 'reg-1')),
        ...Array.from({ length: 40 }, () => quota.reserve(otherHost, 'reg-2'))
      ])
      expect(decisions.every((decision) => decision === 'allowed')).toBe(true)
    } finally {
      await database.query('DELETE FROM push_send_log WHERE host_fingerprint = ?', [otherHost])
    }
  })
  it('reserves a retried event once under concurrent PostgreSQL transactions', async () => {
    const quota = new PushSendQuota(database)
    const event = { notificationEpoch: 'epoch', notificationSeq: 1 }
    const results = await Promise.all(
      Array.from({ length: 40 }, () => quota.reserve(hostFingerprint, 'reg-dedupe', event))
    )
    expect(results.filter((result) => result === 'allowed')).toHaveLength(1)
    expect(results.filter((result) => result === 'duplicate')).toHaveLength(39)
    expect(
      await quota.reserve(hostFingerprint, 'reg-dedupe', { ...event, notificationEpoch: 'next' })
    ).toBe('allowed')
  })
})
