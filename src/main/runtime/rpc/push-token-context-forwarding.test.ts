import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { RpcDispatcher } from './dispatcher'
import { defineMethod } from './core'

/**
 * The dispatcher copies context fields one by one, so a capability added to the
 * type in three places and threaded from the call site still never reaches the
 * handler — and typecheck passes at every step because every type does line up.
 *
 * That is exactly how registerPushToken shipped storing nothing: the handler
 * saw an absent callback, returned `{ registered: false }`, and that is a
 * SUCCESSFUL rpc response, so the phone reported success too.
 */
describe('RpcContext forwarding', () => {
  it('hands setDevicePushToken to the handler', async () => {
    const seen: unknown[] = []
    const probe = defineMethod({
      name: 'test.probe',
      params: z.object({}),
      handler: async (_params, ctx) => {
        seen.push(ctx.setDevicePushToken)
        return { ok: true }
      }
    })
    const dispatcher = new RpcDispatcher({
      runtime: { getRuntimeId: () => 'test-runtime' } as never,
      methods: [probe as never]
    })
    const setDevicePushToken = vi.fn().mockReturnValue(true)

    await dispatcher.dispatchStreaming(
      { id: '1', method: 'test.probe', params: {} } as never,
      () => {},
      { pairedDeviceId: 'dev-1', setDevicePushToken } as never
    )

    expect(seen[0]).toBe(setDevicePushToken)
  })
})
