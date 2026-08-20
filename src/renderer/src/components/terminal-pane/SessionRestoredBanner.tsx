import type { SessionRestoredBannerReason } from './session-restored-banner-pane-state'
import { translate } from '@/i18n/i18n'

// Read at use, not at import: translating here would freeze the banner in
// whichever language happened to be active when this module first loaded.
export function sessionRestoredBannerText(): string {
  return translate(
    'auto.components.terminal.pane.SessionRestoredBanner.f4d06c346b',
    '--- session restored ---'
  )
}
export function sessionResumeUnavailableBannerText(): string {
  return translate(
    'auto.components.terminal.pane.SessionRestoredBanner.139e3d1083',
    '--- previous session unavailable, started fresh ---'
  )
}

type SessionRestoredBannerProps = {
  visible: boolean
  reason?: SessionRestoredBannerReason
}

export function SessionRestoredBanner({
  visible,
  reason = 'restored'
}: SessionRestoredBannerProps): React.JSX.Element | null {
  if (!visible) {
    return null
  }

  return (
    <div className="session-restored-banner">
      {reason === 'resume-unavailable'
        ? sessionResumeUnavailableBannerText()
        : sessionRestoredBannerText()}
    </div>
  )
}
