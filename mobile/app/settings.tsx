import { Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { Languages } from 'lucide-react-native'
import SettingsMenuScreen from '../src/settings/settings-menu-screen'
import { MobileSettingsSection } from '../src/settings/mobile-settings-menu'
import { PendingCredentialCleanupCard } from '../src/settings/pending-credential-cleanup-card'
import { translate } from '../src/i18n/i18n'

export default function NativeSettingsRoute() {
  const router = useRouter()
  return (
    <SettingsMenuScreen
      push={(route) => router.push(route)}
      openExternal={(url) => Linking.openURL(url)}
    >
      {/* Fork-only: the picker is the only way out of an unreadable language. */}
      <MobileSettingsSection
        spaced
        items={[
          {
            label: translate('mobile.settings.language.rowLabel', 'App language'),
            icon: Languages,
            onPress: () => router.push('/language-settings')
          }
        ]}
      />
      <PendingCredentialCleanupCard />
    </SettingsMenuScreen>
  )
}
