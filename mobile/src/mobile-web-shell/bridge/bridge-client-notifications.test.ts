/** The page's outbound notify surface: what it posts, what it stays quiet about, and what it
 *  answers when the shell granted nothing or the port refused the frame. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_FAULT_GRANT, BRIDGE_PROTOCOL_VERSION } from './bridge-envelope'
import { GRANTS, INIT, createPageClient } from './bridge-page-client-test-harness'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bridge client page faults', () => {
  /** A shell that says it will act on a fault, which is the only kind the page posts one to. */
  function startGranted(page: ReturnType<typeof createPageClient>): void {
    page.deliver({ ...INIT, grants: { ...GRANTS, native: [BRIDGE_FAULT_GRANT] } })
  }

  it('posts the captured error once the shell has granted fault reporting', () => {
    const page = createPageClient()
    startGranted(page)
    expect(page.client.notifyPageFault(new Error('the route threw'))).toBe(true)
    expect(page.frames().at(-1)).toEqual({
      v: BRIDGE_PROTOCOL_VERSION,
      type: 'notify',
      name: BRIDGE_FAULT_GRANT,
      error: { category: 'Error', message: 'the route threw', isRpcDeliveryUnknown: false }
    })
  })

  it('stays quiet against a shell that granted nothing, because the frame would be refused whole', () => {
    const page = createPageClient()
    page.start()
    expect(page.client.notifyPageFault(new Error('the route threw'))).toBe(false)
    expect(page.sent).toHaveLength(1)
  })

  it('answers false before a session and after close rather than throwing at a boundary', () => {
    const early = createPageClient()
    expect(early.client.notifyPageFault(new Error('too soon'))).toBe(false)
    const page = createPageClient()
    startGranted(page)
    page.client.close()
    expect(page.client.notifyPageFault(new Error('too late'))).toBe(false)
    expect(page.frames().at(-1)).toEqual({ v: BRIDGE_PROTOCOL_VERSION, type: 'close' })
  })

  it('answers false for a port that refused the frame, and reports it once', () => {
    const page = createPageClient({
      send: () => {
        throw new Error('the channel is gone')
      }
    })
    startGranted(page)
    expect(page.client.notifyPageFault(new Error('the route threw'))).toBe(false)
    expect(page.diagnostics.map((diagnostic) => diagnostic.kind)).toContain('send-failed')
  })
})
