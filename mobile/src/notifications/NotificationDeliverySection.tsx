import { StyleSheet, Switch, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { NotificationDeliveryPreferences } from './notification-delivery-preferences'

type Props = {
  value: NotificationDeliveryPreferences
  disabled?: boolean
  onChange: (value: NotificationDeliveryPreferences) => void
}

export function NotificationDeliverySection({ value, disabled, onChange }: Props) {
  const row = (key: keyof NotificationDeliveryPreferences, label: string) => (
    <View key={key} style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        testID={`notification-${key}`}
        value={value[key]}
        disabled={disabled}
        onValueChange={(enabled) => onChange({ ...value, [key]: enabled })}
        trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
        thumbColor={colors.textPrimary}
      />
    </View>
  )
  return (
    <View style={styles.section}>
      {row('followDesktop', 'Use desktop settings')}
      <Text style={styles.hint}>
        {value.followDesktop
          ? 'Follow each desktop’s notification and event switches. Desktop focus does not silence this phone.'
          : 'Choose which alerts reach this phone, both while connected and in the background. Independent delivery requires an updated desktop.'}
      </Text>
      {!value.followDesktop && (
        <>
          {row('taskFinished', 'Task finished')}
          {row('needsInput', 'Needs input')}
          {row('terminalBell', 'Terminal bell')}
          <Text style={styles.hint}>
            A program requests attention by sending a bell character. This can happen while an agent
            is still working.
          </Text>
          {row('plugin', 'Plugin notifications')}
        </>
      )}
      {row('sound', 'Notification sound')}
      {row('suppressWhileViewing', 'Suppress while viewing workspace')}
      <Text style={styles.hint}>
        Sound and viewing preferences apply only to this phone. Changes reach disconnected desktops
        when they reconnect.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden',
    marginTop: spacing.md
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  label: { flex: 1, fontSize: typography.bodySize, fontWeight: '500', color: colors.textPrimary },
  hint: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md
  }
})
