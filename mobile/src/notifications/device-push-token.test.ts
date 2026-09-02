import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPermissions: vi.fn(),
  getDeviceToken: vi.fn(),
  os: { value: 'ios' as string }
}))

vi.mock('expo-notifications', () => ({
  getPermissionsAsync: mocks.getPermissions,
  getDevicePushTokenAsync: mocks.getDeviceToken
}))
vi.mock('react-native', () => ({
  get Platform() {
    return { OS: mocks.os.value }
  }
}))

import { readDevicePushToken } from './device-push-token'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.os.value = 'ios'
  mocks.getPermissions.mockResolvedValue({ status: 'granted' })
  mocks.getDeviceToken.mockResolvedValue({ data: 'AB'.repeat(32) })
})

describe('readDevicePushToken', () => {
  it('returns the native APNs token, lowercased', async () => {
    expect(await readDevicePushToken()).toEqual({ status: 'ready', token: 'ab'.repeat(32) })
  })

  // Asking is the opt-in screen's decision; a prompt raised from a background
  // reconnect is one the user cannot place.
  it('does not ask for permission it was not given', async () => {
    mocks.getPermissions.mockResolvedValue({ status: 'denied' })

    expect(await readDevicePushToken()).toEqual({ status: 'not-permitted' })
    expect(mocks.getDeviceToken).not.toHaveBeenCalled()
  })

  it('reports Android as unavailable rather than an error', async () => {
    mocks.os.value = 'android'

    expect(await readDevicePushToken()).toMatchObject({ status: 'unavailable' })
    expect(mocks.getPermissions).not.toHaveBeenCalled()
  })

  it('recognises the simulator, which throws instead of returning a sentinel', async () => {
    mocks.getDeviceToken.mockRejectedValue(new Error('Must be run on a real device, not Simulator'))

    expect(await readDevicePushToken()).toEqual({ status: 'unavailable', reason: 'simulator' })
  })

  // The token becomes a URL path segment on the way to Apple.
  it.each([
    ['not hex', 'zz'.repeat(32)],
    ['too short', 'abcd'],
    ['empty', ''],
    ['a path', '../'.repeat(20)]
  ])('refuses a token that is %s', async (_label, data) => {
    mocks.getDeviceToken.mockResolvedValue({ data })

    expect(await readDevicePushToken()).toMatchObject({ status: 'failed' })
  })

  it('surfaces a real failure as failed, not unavailable', async () => {
    mocks.getDeviceToken.mockRejectedValue(new Error('APNs registration timed out'))

    expect(await readDevicePushToken()).toMatchObject({
      status: 'failed',
      reason: 'APNs registration timed out'
    })
  })
})
