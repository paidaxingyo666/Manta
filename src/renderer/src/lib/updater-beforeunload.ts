import {
  MANTA_APP_RESTART_ABORTED_EVENT,
  MANTA_APP_RESTART_STARTED_EVENT,
  MANTA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  MANTA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../../../shared/updater-renderer-events'

let intentionalAppRestartInProgress = false

export function isUpdaterQuitAndInstallInProgress(): boolean {
  return isIntentionalAppRestartInProgress()
}

export function isIntentionalAppRestartInProgress(): boolean {
  return intentionalAppRestartInProgress
}

export function registerUpdaterBeforeUnloadBypass(): () => void {
  const markInProgress = (): void => {
    intentionalAppRestartInProgress = true
  }
  const clearInProgress = (): void => {
    intentionalAppRestartInProgress = false
  }

  window.addEventListener(MANTA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
  window.addEventListener(MANTA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
  window.addEventListener(MANTA_APP_RESTART_STARTED_EVENT, markInProgress)
  window.addEventListener(MANTA_APP_RESTART_ABORTED_EVENT, clearInProgress)

  return () => {
    window.removeEventListener(MANTA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
    window.removeEventListener(MANTA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(MANTA_APP_RESTART_STARTED_EVENT, markInProgress)
    window.removeEventListener(MANTA_APP_RESTART_ABORTED_EVENT, clearInProgress)
    // Why: hot reloads can re-register this listener inside the same renderer.
    // Reset the module flag on cleanup so a failed earlier restart attempt
    // cannot silently suppress future unsaved-change prompts.
    intentionalAppRestartInProgress = false
  }
}
