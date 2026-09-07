import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BACKGROUND_NOTIFICATIONS_HINT,
  BACKGROUND_NOTIFICATIONS_UNSUPPORTED,
  BackgroundNotificationsSection,
  type BackgroundNotificationsSectionProps
} from './BackgroundNotificationsSection'

vi.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View'
}))

describe('BackgroundNotificationsSection', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(overrides: Partial<BackgroundNotificationsSectionProps> = {}) {
    act(() => {
      renderer = create(
        createElement(BackgroundNotificationsSection, {
          supported: true,
          resolved: true,
          enabled: true,
          onToggleEnabled: () => {},
          ...overrides
        })
      )
    })
    return renderer!
  }

  function textOf(tree: ReactTestRenderer): string[] {
    return tree.root
      .findAllByType('Text' as never)
      .map((node) => node.props.children)
      .filter((child): child is string => typeof child === 'string')
  }

  it('shows the switch, the disclosure without a second set of event filters', () => {
    const texts = textOf(render())

    expect(texts).toEqual(['Background notifications', BACKGROUND_NOTIFICATIONS_HINT])
  })

  it('states verbatim which parties see the alert text and the push token', () => {
    expect(BACKGROUND_NOTIFICATIONS_HINT).toBe(
      "Get alerts while Manta is closed. Alerts show the same text as on your desktop. That text, your phone's push token, and opaque host and device ids pass through Manta's push service and Apple or Google. Turning this off or unpairing deletes the token."
    )
  })

  it('replaces the whole section when no paired host advertises remote push', () => {
    const tree = render({ supported: false })

    expect(textOf(tree)).toEqual([BACKGROUND_NOTIFICATIONS_UNSUPPORTED])
    expect(tree.root.findAllByType('Switch' as never)).toHaveLength(0)
  })

  it('renders nothing while the paired hosts are still being probed', () => {
    expect(render({ supported: false, resolved: false }).toJSON()).toBeNull()
  })
})
