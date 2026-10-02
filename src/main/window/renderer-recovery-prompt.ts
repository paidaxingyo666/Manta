import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { translateMain } from '../i18n/main-i18n'
import type { InstallDirAclPoisonDiagnosis } from '../startup/windows-install-dir-acl-recovery'
import type { RecoveryExhaustionCause } from './renderer-recovery-reload-watchdog'

export type RendererRecoveryPromptFailure = RecoveryExhaustionCause

export type RendererRecoveryPromptDeps = {
  recentRecoveryCount: number
  failure?: RendererRecoveryPromptFailure
  /** Shown with failure 'low-commit'. */
  availableCommitMB?: number
  isQuitting: () => boolean
  diagnose: () => InstallDirAclPoisonDiagnosis | null
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  copyToClipboard: (text: string) => void
  reload: () => void
  quit: () => void
}

export async function presentRendererRecoveryPrompt(
  deps: RendererRecoveryPromptDeps
): Promise<void> {
  const stalled = deps.failure === 'reload-stalled'
  const lowCommit = deps.failure === 'low-commit'
  // Copying must preserve the only available recovery surface.
  while (!deps.isQuitting()) {
    // Why skip: the low-commit text replaces diagnosis.detail, which would leave Copy Commands unexplained.
    const diagnosis = lowCommit ? null : deps.diagnose()
    const buttons = [translateMain('rendererRecovery.reload', 'Reload')]
    if (diagnosis) {
      buttons.push(translateMain('rendererRecovery.copyCommands', 'Copy Commands'))
    }
    buttons.push(translateMain('rendererRecovery.quit', 'Quit'))
    const recoveryDetail = lowCommit
      ? translateMain(
          'rendererRecovery.lowCommitDetail',
          'Windows has only {{availableMB}} MB of memory left for apps, so the window ran out of memory again after reloading.',
          { availableMB: deps.availableCommitMB ?? 0 }
        )
      : stalled
        ? translateMain(
            'rendererRecovery.stalledDetail',
            'Manta reloaded the window after a crash, but it never finished loading.'
          )
        : translateMain(
            'rendererRecovery.crashLoopDetail',
            'Manta tried to recover {{recoveryCount}} times in a row without success.',
            { recoveryCount: deps.recentRecoveryCount }
          )
    const causeDetail = lowCommit
      ? translateMain(
          'rendererRecovery.lowCommitAdvice',
          'Free memory by closing unused apps or Manta workspaces, or increase the Windows page file size, then click Reload.'
        )
      : diagnosis
        ? `${diagnosis.detail}\n\n${translateMain(
            'rendererRecovery.driverFallback',
            'If that does not help, the cause is usually a graphics driver.'
          )}`
        : translateMain(
            'rendererRecovery.genericDetail',
            'This is often a graphics-driver or installation problem. Reload to try again, or quit and relaunch Manta.'
          )
    const { response } = await deps.showMessageBox({
      type: 'error',
      buttons,
      defaultId: 0,
      // Escape retries instead of destroying the session.
      cancelId: 0,
      title: translateMain('rendererRecovery.title', 'Manta keeps failing to load'),
      message: lowCommit
        ? translateMain('rendererRecovery.lowCommitMessage', 'Windows is out of memory.')
        : stalled
          ? translateMain(
              'rendererRecovery.stalledMessage',
              'The app window stopped responding while reloading after a crash.'
            )
          : translateMain(
              'rendererRecovery.crashLoopMessage',
              'The app window crashed repeatedly and stopped reloading automatically.'
            ),
      detail: `${recoveryDetail}\n\n${causeDetail}`
    })
    if (response === 1 && diagnosis) {
      deps.copyToClipboard(diagnosis.commands.join('\r\n'))
      continue
    }
    if (response === 0) {
      deps.reload()
    } else if (response === buttons.length - 1) {
      deps.quit()
    }
    return
  }
}
