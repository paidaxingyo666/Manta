import { describe, expect, it } from 'vitest'
import { BRIDGE_FAULT_GRANT } from './bridge-envelope'
import { BRIDGE_GRANT_GATED_NOTIFY_NAMES, bridgeNotifyRefusal } from './bridge-notify-grants'

const GRANTED = [BRIDGE_FAULT_GRANT]

describe('what the host will act on', () => {
  it('refuses every name from a page that has not been told anything', () => {
    for (const name of [BRIDGE_FAULT_GRANT, 'foreground', 'terminalViewport']) {
      expect(bridgeNotifyRefusal({ name, initSent: false, granted: GRANTED }), name).toBe(
        'before-ready'
      )
    }
  })

  it('refuses a gated name this host did not issue', () => {
    // Unreachable while every page is offered `fault`, and the whole point of the check once a
    // grant is per-route: a page on a screen that was granted nothing must not be served one.
    expect(bridgeNotifyRefusal({ name: BRIDGE_FAULT_GRANT, initSent: true, granted: [] })).toBe(
      'ungranted'
    )
  })

  it('serves a gated name this host did issue', () => {
    expect(
      bridgeNotifyRefusal({ name: BRIDGE_FAULT_GRANT, initSent: true, granted: GRANTED })
    ).toBeNull()
  })

  it("serves the protocol's own names against a page that holds no grant at all", () => {
    // `foreground` and the viewport are not grants and must not become ones by being in this file.
    for (const name of ['foreground', 'terminalViewport']) {
      expect(bridgeNotifyRefusal({ name, initSent: true, granted: [] }), name).toBeNull()
      expect(BRIDGE_GRANT_GATED_NOTIFY_NAMES, name).not.toContain(name)
    }
  })
})
