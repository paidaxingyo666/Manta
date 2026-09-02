import { WifiOff, Shield, Monitor, Clock, Globe } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'

export type TroubleshootSection = {
  id: string
  icon: React.ReactNode
  title: string
  steps: string[]
}

export const troubleshootCommonIssues = localizedConstant((): TroubleshootSection[] => [
  {
    id: 'wifi',
    icon: <WifiOff size={16} color={colors.textSecondary} />,
    title: translate('m.troubleshoot.common.issues.bee667fbf1', 'Different WiFi Networks'),
    steps: [
      translate(
        'm.troubleshoot.common.issues.0c558ad505',
        'Both devices must be on the same LAN (unless connected through Tailscale).'
      ),
      translate(
        'm.troubleshoot.common.issues.87abb70237',
        'Ethernet and WiFi must share the same subnet.'
      ),
      translate('m.troubleshoot.common.issues.8c42fc3507', 'Try reconnecting WiFi on both devices.')
    ]
  },
  {
    id: 'firewall',
    icon: <Shield size={16} color={colors.textSecondary} />,
    title: translate('m.troubleshoot.common.issues.6a6637882b', 'Firewall Blocking Port 6768'),
    steps: [
      translate(
        'm.troubleshoot.common.issues.82218b4673',
        'macOS: System Settings → Network → Firewall — allow Manta.'
      ),
      translate(
        'm.troubleshoot.common.issues.b69fc16e2a',
        'Windows: Defender Firewall → Allow app — enable Manta for Private networks.'
      ),
      translate('m.troubleshoot.common.issues.e34d738343', 'Linux: sudo ufw allow 6768'),
      translate(
        'm.troubleshoot.common.issues.aed0bc9e02',
        'Corporate/school networks may block P2P — try a personal hotspot.'
      )
    ]
  },
  {
    id: 'desktop',
    icon: <Monitor size={16} color={colors.textSecondary} />,
    title: translate('m.troubleshoot.common.issues.3040fff325', 'Desktop App Not Running'),
    steps: [
      translate(
        'm.troubleshoot.common.issues.17a9bbbfb4',
        'Manta must be open on your desktop to accept connections.'
      ),
      translate(
        'm.troubleshoot.common.issues.185ef474dc',
        'Try restarting Manta — the companion server starts on launch.'
      ),
      translate(
        'm.troubleshoot.common.issues.9de3f44ca8',
        'After an update, you may need to re-pair via QR code.'
      )
    ]
  },
  {
    id: 'timeout',
    icon: <Clock size={16} color={colors.textSecondary} />,
    title: translate('m.troubleshoot.common.issues.004de673b0', 'Connection Timeout'),
    steps: [
      translate(
        'm.troubleshoot.common.issues.b865b352b1',
        'Check WiFi signal strength on your phone.'
      ),
      translate(
        'm.troubleshoot.common.issues.82f4b5177a',
        'Go back to the host list and tap your host to retry.'
      ),
      translate('m.troubleshoot.common.issues.4bdb4db8ac', 'Restart both apps if timeouts persist.')
    ]
  },
  {
    id: 'tailscale',
    icon: <Globe size={16} color={colors.textSecondary} />,
    title: translate('m.troubleshoot.common.issues.9e08e7e2d6', 'Tailscale Host Unreachable'),
    steps: [
      translate(
        'm.troubleshoot.common.issues.4fa10bd283',
        'Host addresses like 100.x.x.x or *.ts.net connect through Tailscale — keep it ON.'
      ),
      translate(
        'm.troubleshoot.common.issues.ae6327f577',
        'iOS/Android can silently wedge the tunnel: toggle Tailscale off and back on in the Tailscale app.'
      ),
      translate(
        'm.troubleshoot.common.issues.8f429e95d4',
        'Check the desktop is awake and shows as connected in your tailnet.'
      ),
      translate(
        'm.troubleshoot.common.issues.3f17ae0507',
        'Update the Tailscale app — recent releases fix reconnect bugs.'
      )
    ]
  },
  {
    id: 'vpn',
    icon: <Shield size={16} color={colors.textSecondary} />,
    title: translate('m.troubleshoot.common.issues.8cb84f5d74', 'Other VPN Interference'),
    steps: [
      translate(
        'm.troubleshoot.common.issues.9fe597b620',
        'Non-Tailscale VPNs can route local traffic through a remote server.'
      ),
      translate(
        'm.troubleshoot.common.issues.309d528256',
        'Disable that VPN or enable split tunneling / "Allow LAN".'
      )
    ]
  }
])
