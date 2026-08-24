import { describe, expect, it } from 'vitest'
import { RelayPushWakeResultMessageSchema } from './relay-control-protocol'

/**
 * A pending request whose kind has no schema branch falls through to the resume
 * schema, which is .strict() on a different `type`. The reply then fails to
 * parse, the client treats an unparsed control message as a protocol violation,
 * and closes the relay connection — so every push would cost the link, and
 * discardToken would never arrive.
 */
describe('push-wake-result', () => {
  it('accepts what the relay sends', () => {
    expect(
      RelayPushWakeResultMessageSchema.safeParse({
        type: 'push-wake-result',
        reqId: 'r1',
        ok: true,
        discardToken: false
      }).success
    ).toBe(true)
  })

  it('carries discardToken, the only way a dead token travels back', () => {
    const parsed = RelayPushWakeResultMessageSchema.parse({
      type: 'push-wake-result',
      reqId: 'r1',
      ok: false,
      discardToken: true
    })

    expect(parsed.discardToken).toBe(true)
  })

  it('does not accept a different reply shape', () => {
    expect(
      RelayPushWakeResultMessageSchema.safeParse({
        type: 'device-resume-confirmed',
        reqId: 'r1'
      }).success
    ).toBe(false)
  })
})
