import type { MobileConnectionPath } from './stable-logical-rpc-client'
import { translate } from '../i18n/i18n'

export function mobileConnectionPathLabel(path: MobileConnectionPath): string {
  if (path === 'relay') {
    return translate('mobile.hostCard.path.relay', 'Manta Relay')
  }
  return path === 'tailscale'
    ? translate('mobile.hostCard.path.tailscale', 'Direct · Tailscale')
    : translate('mobile.hostCard.path.lan', 'Direct · LAN')
}
