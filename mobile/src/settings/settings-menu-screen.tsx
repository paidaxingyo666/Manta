import type { ReactNode } from 'react'
import { Shield, LifeBuoy } from 'lucide-react-native'
import { MobileSettingsFrame, MobileSettingsSection } from './mobile-settings-menu'
import { mobileSettingsMenuItems } from './mobile-settings-menu-items'
import { translate } from '../i18n/i18n'

export default function SettingsMenuScreen({
  push,
  onBack,
  openExternal,
  children
}: {
  push: (route: string) => void
  onBack?: () => void
  openExternal: (url: string) => Promise<unknown>
  children?: ReactNode
}) {
  return (
    <MobileSettingsFrame onBack={onBack}>
      <MobileSettingsSection items={mobileSettingsMenuItems(push)} />

      {children}

      <MobileSettingsSection
        spaced
        items={[
          {
            label: translate('m.settings.menu.screen.b85b3aed73', 'Privacy Policy'),
            icon: Shield,
            external: true,
            onPress: () => void openExternal('https://www.manta.sh.cn/privacy')
          },
          {
            label: translate('m.settings.menu.screen.62e60fabc8', 'Support'),
            icon: LifeBuoy,
            external: true,
            onPress: () => void openExternal('https://github.com/paidaxingyo666/Manta/issues')
          }
        ]}
      />
    </MobileSettingsFrame>
  )
}
