import { translate } from '@/i18n/i18n'

/** Copy for the install dialog, kept out of the component so its line budget holds. */
export function skillInstallDialogCopy() {
  return {
    enterShareLink: translate(
      'auto.components.skills.install.enterShareLink',
      'Enter a Manta skill share link.'
    ),
    shareUnavailable: translate(
      'auto.components.skills.install.shareUnavailable',
      'This share is unavailable. The link may be invalid, expired, or revoked.'
    ),
    chooseWorkspace: translate(
      'auto.components.skills.install.chooseWorkspace',
      'Choose a workspace.'
    ),
    reconnectBeforeInstalling: translate(
      'auto.components.skills.install.reconnectBeforeInstalling',
      'Reconnect your Manta account before installing.'
    ),
    requestedVersionVerificationFailed: translate(
      'auto.components.skills.install.requestedVersionVerificationFailed',
      'Installation failed before Manta could verify the requested version.'
    ),
    destinationAlreadyFinished: translate(
      'auto.components.skills.install.destinationAlreadyFinished',
      'The destination had already finished this installation.'
    ),
    k01c5a14e01: translate(
      'auto.components.skills.SkillInstallDialog.01c5a14e01',
      'Install shared skills'
    ),
    fcbec627cc: translate(
      'auto.components.skills.SkillInstallDialog.fcbec627cc',
      'Install shared skill'
    ),
    opening: translate(
      'auto.components.skills.SkillInstallDialog.opening',
      'Opening this link…'
    ),
    d198ec91e5: translate(
      'auto.components.skills.SkillInstallDialog.d198ec91e5',
      'Close'
    ),
    k69236de8d6: translate(
      'auto.components.skills.SkillInstallReviewContent.69236de8d6',
      'Checking…'
    ),
    k157de228b4: translate(
      'auto.components.skills.SkillInstallReviewContent.157de228b4',
      'Inspect skill'
    ),
    k05588076a9: translate(
      'auto.components.skills.SkillInstallDialog.05588076a9',
      'Cancel installation'
    ),
    k241e72f9d6: translate(
      'auto.components.skills.SkillInstallDialog.241e72f9d6',
      'Installing…'
    ),
    k59c3b76cdd: translate(
      'auto.components.skills.SkillInstallDialog.59c3b76cdd',
      'Retry install'
    ),
    k39acb9e8f4: translate(
      'auto.components.skills.SkillInstallDialog.39acb9e8f4',
      'Install skill'
    ),
  }
}
