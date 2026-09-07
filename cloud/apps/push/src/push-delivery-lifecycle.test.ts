import { afterEach, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { PushRequestDrain } from './push-request-drain.js'
import { PushCoalescer } from './coalescer.js'
import { PushDispatcher } from './push-dispatcher.js'
import { PushDeviceRegistryStore } from './device-registry-store.js'
import { openInMemoryPushDatabase, type PushDatabase } from './push-database.js'
import { buildPushDelivery } from './push-delivery-message.js'
import { PushNotificationSchema } from '@manta-cloud/push-contract'
import { notification } from './push-server-harness.test-fixture.js'

const databases: PushDatabase[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()))
  vi.restoreAllMocks()
})
const note = PushNotificationSchema.parse(notification())
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function registered() {
  const db = await openInMemoryPushDatabase()
  databases.push(db)
  const devices = new PushDeviceRegistryStore(db)
  const input = {
    hostFingerprint: 'abcdefghijklmnop',
    deviceId: 'device',
    platform: 'android' as const,
    token: 'old-token',
    filter: { sources: [], agentStates: [] }
  }
  const row = await devices.upsert(input)
  if (!row.ok) throw new Error('registration failed')
  const delivery = buildPushDelivery({
    registrationId: row.registrationId,
    hostFingerprint: input.hostFingerprint,
    notification: note,
    title: note.title,
    body: note.body,
    coalescedCount: 1
  })
  return { db, devices, input, delivery }
}

it('does not retire a refreshed token after the old token fails', async () => {
  const h = await registered()
  const gate = deferred()
  const send = vi.fn(async () => {
    await gate.promise
    return { status: 'dead', reason: 'UNREGISTERED' }
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const dispatcher = new PushDispatcher({ devices: h.devices, fcm: { send } as never })
  const pending = dispatcher.deliver(h.delivery)
  await tick()
  await h.devices.upsert({ ...h.input, token: 'replacement-token' })
  gate.resolve()
  await pending
  expect(await h.devices.findById(h.delivery.registrationId)).toMatchObject({
    token: 'replacement-token',
    dead: false
  })
})

it('drains timer-triggered deliveries that already left the window map', async () => {
  const gate = deferred()
  const deliver = vi.fn(() => gate.promise)
  const coalescer = new PushCoalescer({
    deliver,
    setTimer: () => ({ handle: null }),
    clearTimer: () => {}
  })
  coalescer.enqueue({
    registrationId: 'reg',
    hostFingerprint: 'abcdefghijklmnop',
    notification: note
  })
  const pending = coalescer.flush('reg')
  let drained = false
  const drain = coalescer.flushAll().then(() => {
    drained = true
  })
  await tick()
  expect(deliver).toHaveBeenCalledOnce()
  expect(drained).toBe(false)
  gate.resolve()
  await Promise.all([pending, drain])
  expect(drained).toBe(true)
})

it('rejects new requests during drain and waits for an admitted handler', async () => {
  const gate = deferred()
  const requests = new PushRequestDrain()
  const app = new Hono().use('*', requests.middleware).post('/send', async (c) => {
    await gate.promise
    return c.json({ queued: true })
  })
  const pending = app.request('/send', { method: 'POST' })
  await tick()
  let drained = false
  const drain = requests.begin().then(() => {
    drained = true
  })
  expect((await app.request('/send', { method: 'POST' })).status).toBe(503)
  expect(drained).toBe(false)
  gate.resolve()
  expect((await pending).status).toBe(200)
  await drain
  expect(drained).toBe(true)
})

it('retries transient failures with the provider delay and stops after success', async () => {
  const h = await registered()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const send = vi
    .fn()
    .mockResolvedValueOnce({
      status: 'error',
      reason: 'UNAVAILABLE',
      retryable: true,
      retryAfterMs: 10000
    })
    .mockResolvedValue({ status: 'sent' })
  const wait = vi.fn(async (_ms: number) => {})
  await new PushDispatcher({ devices: h.devices, fcm: { send } as never, wait }).deliver(h.delivery)
  expect(send).toHaveBeenCalledTimes(2)
  expect(wait).toHaveBeenCalledExactlyOnceWith(expect.any(Number))
  expect(wait.mock.calls[0]![0]).toBeGreaterThanOrEqual(10000)
})

it('bounds retries and rechecks registration after waiting', async () => {
  const h = await registered()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const send = vi.fn().mockResolvedValue({ status: 'error', reason: 'timeout', retryable: true })
  await new PushDispatcher({
    devices: h.devices,
    fcm: { send } as never,
    wait: async () => {}
  }).deliver(h.delivery)
  expect(send).toHaveBeenCalledTimes(3)
  send.mockClear()
  await new PushDispatcher({
    devices: h.devices,
    fcm: { send } as never,
    wait: async () => {
      await h.devices.deleteOwned(h.input.hostFingerprint, h.delivery.registrationId)
    }
  }).deliver(h.delivery)
  expect(send).toHaveBeenCalledOnce()
})
