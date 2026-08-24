import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRegistry } from './device-registry'

/**
 * A push token lives on the device entry rather than in its own store so it
 * inherits two behaviours for free: it survives a desktop restart — which is the
 * only reason push is worth anything, since the phone that would re-register is
 * asleep — and unpairing takes it away without a second cleanup path.
 */
function registry(): DeviceRegistry {
  return new DeviceRegistry(mkdtempSync(join(tmpdir(), 'dev-reg-')))
}

function pair(reg: DeviceRegistry): string {
  const device = reg.addDevice('phone', 'mobile')
  return typeof device === 'string' ? device : device.deviceId
}

const TOKEN = { value: 'a'.repeat(64), platform: 'ios' as const, updatedAt: 1 }

describe('device push tokens', () => {
  it('records a token against a paired device', () => {
    const reg = registry()
    const id = pair(reg)

    expect(reg.setPushToken(id, TOKEN)).toBe(true)
    expect(reg.getDevice(id)?.pushToken).toEqual(TOKEN)
  })

  // The phone re-registers on every launch; a token it has replaced must not
  // linger to be tried and rejected.
  it('overwrites rather than accumulating', () => {
    const reg = registry()
    const id = pair(reg)
    reg.setPushToken(id, TOKEN)

    const next = { value: 'b'.repeat(64), platform: 'ios' as const, updatedAt: 2 }
    reg.setPushToken(id, next)

    expect(reg.getDevice(id)?.pushToken).toEqual(next)
  })

  it('survives a restart, which is the only reason push is worth anything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-reg-'))
    const first = new DeviceRegistry(dir)
    const id = pair(first)
    first.setPushToken(id, TOKEN)

    expect(new DeviceRegistry(dir).getDevice(id)?.pushToken).toEqual(TOKEN)
  })

  // APNs reports a dead token once; retrying it forever is the alternative.
  it('clears a token without disturbing the rest of the device', () => {
    const reg = registry()
    const id = pair(reg)
    reg.setPushToken(id, TOKEN)

    expect(reg.clearPushToken(id)).toBe(true)
    expect(reg.getDevice(id)?.pushToken).toBeUndefined()
    expect(reg.getDevice(id)?.deviceId).toBe(id)
  })

  it('takes the token away when the device is unpaired', () => {
    const reg = registry()
    const id = pair(reg)
    reg.setPushToken(id, TOKEN)

    reg.removeDevice(id)

    expect(reg.getDevice(id)).toBeNull()
  })

  it('refuses a device that is not paired', () => {
    expect(registry().setPushToken('nope', TOKEN)).toBe(false)
    expect(registry().clearPushToken('nope')).toBe(false)
  })
})
