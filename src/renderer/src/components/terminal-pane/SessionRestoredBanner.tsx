import type { SessionRestoredBannerReason } from './session-restored-banner-pane-state'
import { translate } from '@/i18n/i18n'

export const SESSION_RESTORED_BANNER_TEXT = translate(
  'auto.components.terminal.pane.SessionRestoredBanner.f4d06c346b',
  '--- session restored ---'
)
export const SESSION_RESUME_UNAVAILABLE_BANNER_TEXT = translate(
  'auto.components.terminal.pane.SessionRestoredBanner.139e3d1083',
  '--- previous session unavailable, started fresh ---'
)

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
        ? SESSION_RESUME_UNAVAILABLE_BANNER_TEXT
        : SESSION_RESTORED_BANNER_TEXT}
    </div>
  )
}
