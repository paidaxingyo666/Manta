import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ readToken: vi.fn() }))
vi.mock('./device-push-token', () => ({ readDevicePushToken: mocks.readToken }))

import { reportPushToken } from './push-token-reporting'

const TOKEN = 'a'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readToken.mockResolvedValue({ status: 'ready', token: TOKEN })
})

describe('reportPushToken', () => {
  it('sends the token to the desktop', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true })

    expect(await reportPushToken({ sendRequest })).toEqual({ reported: true })
    expect(sendRequest).toHaveBeenCalledWith(
      'notifications.registerPushToken',
      expect.objectContaining({ deviceToken: TOKEN, platform: 'ios' })
    )
  })

  // None of these deserve a retry: no permission is the user's choice, and a
  // simulator has no APNs token to give.
  it.each([['not-permitted'], ['unavailable'], ['failed']])(
    'does not call the desktop when the token is %s',
    async (status) => {
      mocks.readToken.mockResolvedValue({ status })
      const sendRequest = vi.fn()

      expect(await reportPushToken({ sendRequest })).toEqual({ reported: false, reason: status })
      expect(sendRequest).not.toHaveBeenCalled()
    }
  )

  // An older desktop does not know this method; the catch-up that predates push
  // still delivers everything once the app is opened.
  it('treats an unknown method as no push, not a failure to recover from', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: false })

    expect(await reportPushToken({ sendRequest })).toEqual({ reported: false, reason: 'rejected' })
  })

  // "No key" alone cannot tell a phone without the extension from one whose
  // keychain write failed — and from the desktop that is the only visible signal.
  it('names the failing step when it has no key to send', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true })
    await reportPushToken({ sendRequest })

    const sent = sendRequest.mock.calls[0][1] as Record<string, string>
    expect(sent.encryptionKeyB64).toBeUndefined()
    expect(sent.keyUnavailableReason).toMatch(/unavailable|failed/)
  })

  it('never throws into the connect path', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('socket closed'))

    await expect(reportPushToken({ sendRequest })).resolves.toEqual({
      reported: false,
      reason: 'failed'
    })
  })
})
