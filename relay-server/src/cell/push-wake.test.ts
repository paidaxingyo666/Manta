import { describe, expect, it, vi } from 'vitest'
import { handleControlRequest, type ControlDeps, type PushWakeSender } from './control-requests.js'

function deps(sendPush?: PushWakeSender): ControlDeps {
  return {
    store: {} as never,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never,
    metrics: { counter: vi.fn() } as never,
    resumeTtlMs: 1000,
    graceTtlMs: 1000,
    maxInviteAttempts: 3,
    maxDevicesPerHost: 8,
    maxLiveInvitesPerHost: 4,
    maxLedgerEntriesPerHost: 64,
    ...(sendPush ? { sendPush } : {})
  }
}

const SESSION = { relayHostId: 'host-1' } as never
const TOKEN = 'a'.repeat(64)

function wake(
  sendPush: PushWakeSender | undefined,
  message: Record<string, unknown>
): { replies: unknown[]; handled: boolean } {
  const replies: unknown[] = []
  const handled = handleControlRequest(
    SESSION,
    (payload) => replies.push(payload),
    { reqId: 'r1', ...message },
    'push-wake',
    deps(sendPush),
    Date.now()
  )
  return { replies, handled }
}

const sender = (result: Partial<Awaited<ReturnType<PushWakeSender>>> = {}): PushWakeSender =>
  vi.fn().mockResolvedValue({ ok: true, discardToken: false, ...result })

describe('push-wake', () => {
  it('hands a well-formed request to APNs', async () => {
    const send = sender()
    const { replies, handled } = wake(send, { deviceToken: TOKEN, payload: { aps: {} } })
    await vi.waitFor(() => expect(replies).toHaveLength(1))

    expect(handled).toBe(true)
    expect(send).toHaveBeenCalledWith({
      deviceToken: TOKEN,
      payload: { aps: {} },
      collapseId: undefined
    })
    expect(replies[0]).toMatchObject({ type: 'push-wake-result', reqId: 'r1', ok: true })
  })

  it('passes the collapse id through, so a backlog stays one notification', async () => {
    const send = sender()
    wake(send, { deviceToken: TOKEN, payload: { aps: {} }, collapseId: 'wt-42' })
    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ collapseId: 'wt-42' }))
  })

  // The desktop is the only holder of device tokens; a dead one has to travel
  // back or it is retried forever.
  it('reports a dead token so the desktop stops using it', async () => {
    const { replies } = wake(sender({ ok: false, discardToken: true, reason: 'Unregistered' }), {
      deviceToken: TOKEN,
      payload: { aps: {} }
    })
    await vi.waitFor(() => expect(replies).toHaveLength(1))

    expect(replies[0]).toMatchObject({ ok: false, discardToken: true })
  })

  it('refuses when the operator has not configured APNs', () => {
    const { replies } = wake(undefined, { deviceToken: TOKEN, payload: { aps: {} } })

    expect(replies[0]).toMatchObject({ type: 'control-error', code: 'push_not_configured' })
  })

  // The token becomes a URL path segment on the way to Apple.
  it.each([
    ['not hex', 'z'.repeat(64)],
    ['too short', 'ab'],
    ['a path traversal', '../'.repeat(10) + 'a'.repeat(34)],
    ['missing', undefined]
  ])('rejects a device token that is %s', async (_label, deviceToken) => {
    const send = sender()
    const { replies } = wake(send, { deviceToken, payload: { aps: {} } })

    expect(replies[0]).toMatchObject({ code: 'invalid_device_token' })
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ['an array', []],
    ['a string', 'aps'],
    ['missing', undefined]
  ])('rejects a payload that is %s', (_label, payload) => {
    const send = sender()
    const { replies } = wake(send, { deviceToken: TOKEN, payload })

    expect(replies[0]).toMatchObject({ code: 'invalid_push_payload' })
    expect(send).not.toHaveBeenCalled()
  })

  it('answers rather than hanging when the sender throws', async () => {
    const send = vi.fn().mockRejectedValue(new Error('apns down'))
    const { replies } = wake(send, { deviceToken: TOKEN, payload: { aps: {} } })
    await vi.waitFor(() => expect(replies).toHaveLength(1))

    expect(replies[0]).toMatchObject({ type: 'push-wake-result', ok: false })
  })
})
