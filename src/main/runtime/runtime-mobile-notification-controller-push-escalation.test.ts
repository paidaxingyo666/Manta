import { expect, it, vi } from 'vitest'
import {
  RuntimeMobileNotificationController,
  type MobileNotificationDispatchEvent
} from './runtime-mobile-notification-controller'

// The relay push must carry only what the phone's legacy socket stream would show.
function controllerWithEscalation() {
  const controller = new RuntimeMobileNotificationController()
  const schedule = vi.fn()
  controller.setPushEscalation({ schedule })
  return { controller, schedule }
}

const alert: MobileNotificationDispatchEvent = {
  type: 'notification',
  source: 'agent-task-complete',
  title: 'Done',
  body: '',
  worktreeId: 'wt-1'
}

it('does not escalate an event the desktop suppressed', () => {
  const { controller, schedule } = controllerWithEscalation()
  controller.dispatch({ ...alert, desktopAllowed: false, emittedAt: 10_000 })
  expect(schedule).not.toHaveBeenCalled()
})

it('escalates the first event but not a same-worktree repeat inside the cooldown', () => {
  const { controller, schedule } = controllerWithEscalation()
  controller.dispatch({ ...alert, title: 'first', emittedAt: 10_000 })
  controller.dispatch({ ...alert, title: 'repeat', emittedAt: 10_250 })
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(schedule).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'first', legacySocketAllowed: true, notificationSeq: 1 })
  )
})
