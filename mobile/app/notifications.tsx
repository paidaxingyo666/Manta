import { useRouter } from 'expo-router'
import NotificationsScreen from '../src/settings/notification-settings-screen'
import { nativeNotificationSettingsOperations } from '../src/settings/native-notification-settings-operations'

// Why no delivery filters or push test: both only work through the hosted push gateway, not the relay.
export default function NativeNotificationsRoute() {
  const router = useRouter()
  return (
    <NotificationsScreen
      operations={nativeNotificationSettingsOperations}
      onBack={() => router.back()}
    />
  )
}
