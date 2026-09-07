import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DeviceRegistry } from '../device-registry'
import { DesktopPushService } from './desktop-push-service'
import { PushUnregisterOutbox } from './push-unregister-outbox'
import { createPushHostKeypair } from './push-host-challenge-fixtures'
import { PushDispatcher } from './push-dispatcher'

const paths: string[] = []
afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
const input = {
  platform: 'android' as const,
  token: 'synthetic',
  filter: { sources: ['plugin'] as const, agentStates: [] }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

function harness() {
  const path = mkdtempSync(join(tmpdir(), 'push-races-'))
  paths.push(path)
  const registry = new DeviceRegistry(path)
  const deviceId = registry.addDevice('phone', 'mobile').deviceId
  const outbox = new PushUnregisterOutbox(path)
  let live = false
  let reachable = true
  const client = {
    registerDevice: vi.fn(async () => {
      live = true
      return { ok: true, registrationId: 'stable-id' }
    }),
    deleteDevice: vi.fn(async () => {
      if (!reachable) {
        return { deleted: false, retryable: true }
      }
      live = false
      return { deleted: true, retryable: false }
    }),
    send: vi.fn()
  }
  const service = DesktopPushService.create({
    gatewayUrl: 'https://push.example.test',
    client: client as never,
    scheduleRetry: () => {},
    runtime: {
      setMobilePushRegistrar: () => {},
      onNotificationDispatched: () => () => {}
    } as never,
    runtimeRpc: {
      getE2EEKeypair: createPushHostKeypair,
      getDeviceRegistry: () => registry,
      getPushUnregisterOutbox: () => outbox,
      setOnPushUnregisterQueued: () => {}
    } as never
  })!
  service.start()
  return {
    registry,
    deviceId,
    outbox,
    client,
    service,
    live: () => live,
    reachable: (value: boolean) => {
      reachable = value
    }
  }
}

it('deletes obsolete gateway state before reporting successful re-enable', async () => {
  const h = harness()
  await h.service.register({ ...input, deviceId: h.deviceId })
  h.reachable(false)
  await h.service.unregister(h.deviceId)
  await h.service.flushUnregisterOutbox()
  expect(h.outbox.pending()).toHaveLength(1)
  expect(await h.service.register({ ...input, deviceId: h.deviceId })).toMatchObject({
    registered: false
  })
  h.reachable(true)
  expect(await h.service.register({ ...input, deviceId: h.deviceId })).toMatchObject({
    registered: true
  })
  await h.service.flushUnregisterOutbox()
  expect(h.live()).toBe(true)
  expect(h.outbox.pending()).toEqual([])
})

it('waits for an already-running delete before re-registering', async () => {
  const h = harness()
  await h.service.register({ ...input, deviceId: h.deviceId })
  let release!: () => void
  const normalDelete = h.client.deleteDevice.getMockImplementation()!
  h.client.deleteDevice.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return normalDelete()
  })
  await h.service.unregister(h.deviceId)
  await tick()
  const registration = h.service.register({ ...input, deviceId: h.deviceId })
  await tick()
  expect(h.client.registerDevice).toHaveBeenCalledTimes(1)
  release()
  await registration
  await h.service.flushUnregisterOutbox()
  expect(h.live()).toBe(true)
})

it('orders unregister after a register already in flight', async () => {
  const h = harness()
  let release!: () => void
  const normalRegister = h.client.registerDevice.getMockImplementation()!
  h.client.registerDevice.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return normalRegister()
  })
  const registered = h.service.register({ ...input, deviceId: h.deviceId })
  await tick()
  const unregistered = h.service.unregister(h.deviceId)
  release()
  await Promise.all([registered, unregistered])
  await h.service.flushUnregisterOutbox()
  expect(h.registry.getDevice(h.deviceId)?.pushRegistration).toBeUndefined()
  expect(h.live()).toBe(false)
})

it('does not clear a replacement with the same ID and timestamp after a stale dead response', async () => {
  const h = harness()
  await h.service.register({ ...input, deviceId: h.deviceId })
  let finish!: (value: unknown) => void
  h.client.send.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const dispatcher = new PushDispatcher({ registry: h.registry, client: h.client as never })
  dispatcher.enqueue({
    type: 'notification',
    source: 'plugin',
    title: 'test',
    body: '',
    notificationEpoch: 'epoch',
    notificationSeq: 1
  })
  const original = h.registry.getDevice(h.deviceId)!.pushRegistration!
  h.registry.setPushRegistration(h.deviceId, { ...original })
  finish({ ok: true, results: [{ registrationId: 'stable-id', status: 'dead' }] })
  await tick()
  expect(h.registry.getDevice(h.deviceId)?.pushRegistration).toEqual(original)
})
