import { describe, expect, it, vi } from 'vitest'
import { NOTIFICATION_METHODS } from './notifications'

/**
 * The failure mode these guard: a successful RPC response carrying
 * `registered: false` reads as success to any caller that checks `ok`, and that
 * is how this shipped storing nothing while both sides believed it worked.
 */
const method = NOTIFICATION_METHODS.find(
  (candidate) => candidate.name === 'notifications.registerPushToken'
)

const TOKEN = { deviceToken: 'a'.repeat(64), platform: 'ios' as const }

function invoke(ctx: Record<string, unknown>) {
  return (method as never as { handler: (p: unknown, c: unknown) => Promise<unknown> }).handler(
    TOKEN,
    ctx
  )
}

describe('notifications.registerPushToken', () => {
  it('stores the token against the calling device', async () => {
    const setDevicePushToken = vi.fn().mockReturnValue(true)

    await expect(invoke({ pairedDeviceId: 'dev-1', setDevicePushToken })).resolves.toEqual({
      registered: true
    })
    expect(setDevicePushToken).toHaveBeenCalledWith('dev-1', {
      value: TOKEN.deviceToken,
      platform: 'ios',
      updatedAt: expect.any(Number)
    })
  })

  it('fails loudly when the caller is not a paired device', async () => {
    await expect(invoke({ setDevicePushToken: vi.fn() })).rejects.toThrow(/paired device/)
  })

  // The dispatcher copies context fields one at a time; a capability that is
  // typed everywhere and forwarded nowhere lands here.
  it('fails loudly when the runtime cannot store tokens', async () => {
    await expect(invoke({ pairedDeviceId: 'dev-1' })).rejects.toThrow(/cannot store/)
  })

  it('fails loudly when the device is gone', async () => {
    const setDevicePushToken = vi.fn().mockReturnValue(false)

    await expect(invoke({ pairedDeviceId: 'ghost', setDevicePushToken })).rejects.toThrow(
      /No such paired device/
    )
  })
})
