import { translate } from '@/i18n/i18n'

export function skillInstallManagementCopy() {
  return {
    inspectManagedFailed: translate(
      'auto.components.skills.install.inspectManagedFailed',
      'Manta could not inspect managed installs on this machine.'
    ),
    reconnectForVersionHistory: translate(
      'auto.components.skills.install.reconnectForVersionHistory',
      'Reconnect your Manta account to load version history.'
    ),
    versionHistoryUnavailable: translate(
      'auto.components.skills.install.versionHistoryUnavailable',
      'Version history is unavailable for this skill.'
    ),
    bundleSkillsMissing: translate(
      'auto.components.skills.install.bundleSkillsMissing',
      'This version does not contain any of the installed bundle skills.'
    ),
    reconnectBeforeVersionChange: translate(
      'auto.components.skills.install.reconnectBeforeVersionChange',
      'Reconnect your Manta account before changing versions.'
    ),
    versionVerificationFailed: translate(
      'auto.components.skills.install.versionVerificationFailed',
      'Manta could not verify the requested version.'
    ),
    destinationAlreadyFinished: translate(
      'auto.components.skills.install.destinationAlreadyFinished',
      'The destination had already finished this installation.'
    ),
    removeFailed: translate(
      'auto.components.skills.install.removeFailed',
      'Manta could not safely remove this skill.'
    ),
    title: translate(
      'auto.components.skills.SkillInstallManagementDialog.44d118a8f7',
      'Installed by Manta'
    ),
    description: translate(
      'auto.components.skills.SkillInstallManagementDialog.3677ae58e7',
      'Skills Manta installed from a link. Reinstall, go back to an earlier version, or remove them.'
    ),
    localMachine: translate(
      'auto.components.skills.SkillInstallManagementDialog.6cb1fbe039',
      'This computer'
    ),
    ssh: translate('auto.components.skills.SkillInstallManagementDialog.176fef9516', '· SSH'),
    disconnected: translate(
      'auto.components.skills.SkillInstallManagementDialog.0900db719a',
      '— disconnected'
    ),
    noInstalls: translate(
      'auto.components.skills.SkillInstallManagementDialog.64c71cf7b9',
      'Manta has not installed any skills on this machine yet.'
    ),
    bundleResult: (installed: number, updated: number, keptLocal: number) =>
      translate(
        'auto.components.skills.SkillInstallManagementDialog.dab29e4b54',
        '{{installed}} installed · {{updated}} updated · {{keptLocal}} kept local',
        { installed, updated, keptLocal }
      ),
    close: translate('auto.components.skills.SkillInstallManagementDialog.8095927ff3', 'Close')
  }
}
