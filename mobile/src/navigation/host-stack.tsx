import { Stack } from 'expo-router'
import { colors } from '../theme/mobile-theme'
import { hostStackScreens, type HostStackAnimation } from './host-stack-screens'

export function HostStack({ animation }: { animation: HostStackAnimation }) {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgBase },
        // In the tablet split view the detail pane should swap instantly like
        // a desktop master-detail; the default slide animates the outgoing
        // screen and briefly reveals the one beneath it. Phones keep the slide.
        animation
      }}
    >
      {hostStackScreens().map(({ name, title }) => (
        <Stack.Screen key={name} name={name} options={{ title }} />
      ))}
    </Stack>
  )
}
