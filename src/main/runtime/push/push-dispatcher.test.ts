import { describe, expect, it, vi } from 'vitest'
import type { PushGatewayClient } from './push-gateway-client'
import { PushDispatcher } from './push-dispatcher'
import {
  createHarness,
  flush,
  notification,
  registration,
  type SendCall
} from './push-dispatcher.test-fixture'

describe('PushDispatcher', () => {
  it('batches every matching registration into one send', async () => {
    const harness = createHarness({
      devices: [
        { deviceId: 'a', pushRegistration: registration({ registrationId: 'reg-a' }) },
        { deviceId: 'b', pushRegistration: registration({ registrationId: 'reg-b' }) },
        { deviceId: 'c' }
      ]
    })

    harness.dispatcher.enqueue(notification())
    await flush()

    expect(harness.sends).toHaveLength(1)
    expect(harness.sends[0]?.registrationIds).toEqual(['reg-a', 'reg-b'])
    expect(harness.sends[0]?.notification).toMatchObject({
      source: 'agent-task-complete',
      agentState: 'finished',
      notificationSeq: 7,
      notificationEpoch: 'epoch-1',
      worktreeId: 'repo::wt1'
    })
  })

  it('fans out past the per-request cap instead of starving the extra devices', async () => {
    const devices = Array.from({ length: 25 }, (_, index) => ({
      deviceId: `device-${index}`,
      pushRegistration: registration({ registrationId: `reg-${index}` })
    }))
    const harness = createHarness({ devices })

    harness.dispatcher.enqueue(notification())
    await flush()

    expect(harness.sends).toHaveLength(2)
    expect(harness.sends[0]?.registrationIds).toHaveLength(20)
    expect(harness.sends[1]?.registrationIds).toEqual([
      'reg-20',
      'reg-21',
      'reg-22',
      'reg-23',
      'reg-24'
    ])
  })

  it('drops a dead registration reported by a later chunk', async () => {
    const devices = Array.from({ length: 25 }, (_, index) => ({
      deviceId: `device-${index}`,
      pushRegistration: registration({ registrationId: `reg-${index}` })
    }))
    const harness = createHarness({
      devices,
      results: [{ registrationId: 'reg-24', status: 'dead' }]
    })

    harness.dispatcher.enqueue(notification())
    await flush()

    expect(harness.cleared).toEqual(['device-24'])
  })

  it('never pushes a dismissal', async () => {
    const harness = createHarness({
      devices: [{ deviceId: 'a', pushRegistration: registration() }]
    })

    harness.dispatcher.enqueue({
      type: 'dismiss',
      notificationId: 'agent:one',
      notificationSeq: 8,
      notificationEpoch: 'epoch-1'
    })
    await flush()

    expect(harness.sends).toHaveLength(0)
  })

  it('stays silent while the agent is still working', async () => {
    const harness = createHarness({
      devices: [{ deviceId: 'a', pushRegistration: registration() }]
    })

    harness.dispatcher.enqueue(notification({ agentState: 'working' }))
    await flush()

    expect(harness.sends).toHaveLength(0)
  })

  it('applies each device filter independently', async () => {
    const harness = createHarness({
      devices: [
        {
          deviceId: 'needs-input-only',
          pushRegistration: registration({
            registrationId: 'reg-needs',
            filter: { sources: ['agent-task-complete'], agentStates: ['needs-input'] }
          })
        },
        {
          deviceId: 'bells-only',
          pushRegistration: registration({
            registrationId: 'reg-bell',
            filter: { sources: ['terminal-bell'], agentStates: ['needs-input', 'finished'] }
          })
        },
        { deviceId: 'everything', pushRegistration: registration({ registrationId: 'reg-all' }) }
      ]
    })

    harness.dispatcher.enqueue(notification({ agentState: 'blocked' }))
    await flush()

    expect(harness.sends[0]?.registrationIds).toEqual(['reg-needs', 'reg-all'])
  })

  it('pushes a bell to a device that filtered agent states out', async () => {
    const harness = createHarness({
      devices: [
        {
          deviceId: 'a',
          pushRegistration: registration({
            filter: { sources: ['terminal-bell'], agentStates: [] }
          })
        }
      ]
    })

    harness.dispatcher.enqueue(
      notification({ source: 'terminal-bell', agentState: undefined, title: 'Bell in x' })
    )
    await flush()

    expect(harness.sends[0]?.notification.agentState).toBeNull()
  })

  it('drops a registration the gateway reports dead', async () => {
    const harness = createHarness({
      devices: [
        { deviceId: 'a', pushRegistration: registration({ registrationId: 'reg-a' }) },
        { deviceId: 'b', pushRegistration: registration({ registrationId: 'reg-b' }) }
      ],
      results: [
        { registrationId: 'reg-a', status: 'dead' },
        { registrationId: 'reg-b', status: 'queued' }
      ]
    })

    harness.dispatcher.enqueue(notification())
    await flush()

    expect(harness.cleared).toEqual(['a'])
  })

  it('retries once when the gateway is unreachable', async () => {
    const sends: SendCall[] = []
    const client = {
      send: vi.fn(async (input: SendCall) => {
        sends.push(input)
        return { ok: false as const, reason: 'unreachable' as const }
      })
    } as unknown as PushGatewayClient
    const scheduled: (() => void)[] = []
    const devices = [{ deviceId: 'a', pushRegistration: registration() }]
    const dispatcher = new PushDispatcher({
      client,
      registry: {
        listDevices: () => devices,
        setPushRegistration: () => true
      },
      scheduleRetry: (run, delayMs) => {
        expect(delayMs).toBe(2_000)
        scheduled.push(run)
      }
    })

    dispatcher.enqueue(notification())
    await flush()
    expect(sends).toHaveLength(1)
    expect(scheduled).toHaveLength(1)

    scheduled[0]?.()
    await flush()
    expect(sends).toHaveLength(2)
    // The second attempt is the last one; a further retry is never scheduled.
    expect(scheduled).toHaveLength(1)
  })

  it('never throws into the caller when the client rejects', async () => {
    const harness = createHarness({
      devices: [{ deviceId: 'a', pushRegistration: registration() }],
      sendImpl: async () => {
        throw new Error('boom')
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => harness.dispatcher.enqueue(notification())).not.toThrow()
    await flush()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('never throws when the registry itself fails', async () => {
    const dispatcher = new PushDispatcher({
      client: { send: vi.fn() } as unknown as PushGatewayClient,
      registry: {
        listDevices: () => {
          throw new Error('registry unavailable')
        },
        setPushRegistration: () => true
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => dispatcher.enqueue(notification())).not.toThrow()
    warn.mockRestore()
  })
})
