import { describe, expect, it } from 'vitest'
import { allowsMobileNotification } from './mobile-notification-policy'
import {
  MOBILE_PUSH_SOURCES,
  MOBILE_PUSH_AGENT_STATES,
  parseMobilePushRegistration
} from './mobile-push-contract'

describe('notification delivery preferences', () => {
  const filter = { sources: MOBILE_PUSH_SOURCES, agentStates: MOBILE_PUSH_AGENT_STATES }
  it.each(['agent-task-complete', 'terminal-bell', 'plugin'])(
    'mirrors desktop settings for %s, but permits an explicit override',
    (source) => {
      const event = { source, desktopAllowed: false }
      expect(allowsMobileNotification(filter, event)).toBe(false)
      expect(allowsMobileNotification({ ...filter, followDesktop: true }, event)).toBe(false)
      expect(allowsMobileNotification({ ...filter, followDesktop: false }, event)).toBe(true)
      expect(allowsMobileNotification(filter, { source })).toBe(true)
    }
  )
  it('keeps bells independent of agent states and supports disabling them', () => {
    expect(
      allowsMobileNotification({ ...filter, agentStates: [] }, { source: 'terminal-bell' })
    ).toBe(true)
    expect(
      allowsMobileNotification(
        { ...filter, sources: ['agent-task-complete'] },
        { source: 'terminal-bell' }
      )
    ).toBe(false)
  })
  it.each(['working', 'unknown'])('never presents %s agent activity', (agentState) => {
    expect(allowsMobileNotification(filter, { source: 'agent-task-complete', agentState })).toBe(
      false
    )
  })
  it('preserves independent mode and silence through a desktop restart', () => {
    expect(
      parseMobilePushRegistration({
        registrationId: 'r',
        platform: 'ios',
        registeredAt: 1,
        filter: { ...filter, followDesktop: false, sound: false }
      })?.filter
    ).toEqual({ ...filter, followDesktop: false, sound: false })
  })
})
