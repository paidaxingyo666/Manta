import { expect, it } from 'vitest'
import { createHarness, notification, registration, flush } from './push-dispatcher.test-fixture'

it('routes a desktop-disabled bell only to a phone that independently permits bells', async () => {
  const filter = registration().filter
  const harness = createHarness({
    devices: [
      {
        deviceId: 'mirror',
        pushRegistration: registration({
          registrationId: 'mirror',
          filter: { ...filter, followDesktop: true }
        })
      },
      {
        deviceId: 'override',
        pushRegistration: registration({
          registrationId: 'override',
          filter: { ...filter, followDesktop: false, sound: false }
        })
      },
      {
        deviceId: 'no-bells',
        pushRegistration: registration({
          registrationId: 'no-bells',
          filter: { ...filter, followDesktop: false, sources: ['agent-task-complete'] }
        })
      }
    ]
  })
  harness.dispatcher.enqueue(notification({ source: 'terminal-bell', desktopAllowed: false }))
  await flush()
  expect(harness.sends).toHaveLength(1)
  expect(harness.sends[0]).toMatchObject({
    registrationIds: ['override'],
    notification: { sound: false }
  })
})

it('keeps sound preferences separate when several phones receive the same event', async () => {
  const harness = createHarness({
    devices: [
      { deviceId: 'loud', pushRegistration: registration({ registrationId: 'loud' }) },
      {
        deviceId: 'quiet',
        pushRegistration: registration({
          registrationId: 'quiet',
          filter: { ...registration().filter, sound: false }
        })
      }
    ]
  })
  harness.dispatcher.enqueue(notification())
  await flush()
  expect(harness.sends).toHaveLength(2)
  expect(harness.sends[0]).toMatchObject({ registrationIds: ['loud'] })
  expect(harness.sends[0].notification.sound).toBeUndefined()
  expect(harness.sends[1]).toMatchObject({
    registrationIds: ['quiet'],
    notification: { sound: false }
  })
})

it('applies burst suppression after each phone filters event types', async () => {
  const harness = createHarness({
    devices: [
      {
        deviceId: 'all',
        pushRegistration: registration({
          registrationId: 'all',
          filter: { ...registration().filter, followDesktop: false }
        })
      },
      {
        deviceId: 'no-bells',
        pushRegistration: registration({
          registrationId: 'no-bells',
          filter: { ...registration().filter, sources: ['agent-task-complete'] }
        })
      }
    ]
  })
  harness.dispatcher.enqueue(notification({ source: 'terminal-bell', emittedAt: 10000 }))
  harness.dispatcher.enqueue(notification({ emittedAt: 10250 }))
  await flush()
  expect(harness.sends.map((send) => send.registrationIds)).toEqual([['all'], ['no-bells']])
})
