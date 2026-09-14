import { Bell, Globe, Info, MessageSquare, Mic, Terminal, Wrench } from 'lucide-react-native'
import type { MobileSettingsMenuItem } from './mobile-settings-menu'
import { translate } from '../i18n/i18n'

export function mobileSettingsMenuItems(push: (route: string) => void): MobileSettingsMenuItem[] {
  return [
    {
      label: translate('m.mobile.settings.menu.items.fda4c3d2d0', 'Terminal'),
      icon: Terminal,
      onPress: () => push('/terminal-settings')
    },
    {
      label: translate('m.mobile.settings.menu.items.82ea5ffe60', 'Chat UI'),
      icon: MessageSquare,
      onPress: () => push('/native-chat-settings')
    },
    {
      label: translate('m.mobile.settings.menu.items.a3bf36eb8f', 'Browser'),
      icon: Globe,
      onPress: () => push('/browser-settings')
    },
    {
      label: translate('m.mobile.settings.menu.items.7b6816cf92', 'Voice'),
      icon: Mic,
      onPress: () => push('/voice-settings')
    },
    {
      label: translate('m.mobile.settings.menu.items.a28c864340', 'Notifications'),
      icon: Bell,
      onPress: () => push('/notifications')
    },
    {
      label: translate('m.mobile.settings.menu.items.27da65e31a', 'Troubleshooting'),
      icon: Wrench,
      onPress: () => push('/troubleshoot')
    },
    {
      label: translate('m.mobile.settings.menu.items.c284d1656b', 'About'),
      icon: Info,
      onPress: () => push('/about')
    }
  ]
}
