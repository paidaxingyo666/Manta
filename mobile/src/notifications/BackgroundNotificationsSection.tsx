import { StyleSheet, Switch, Text, View } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'

// Verbatim from the push contract: it is the disclosure for handing a native push
// token to Manta's gateway and to Apple or Google, so the wording is not ours to edit.
export const BACKGROUND_NOTIFICATIONS_HINT =
  "Get alerts while Manta is closed. Alerts show the same text as on your desktop. That text, your phone's push token, and opaque host and device ids pass through Manta's push service and Apple or Google. Turning this off or unpairing deletes the token."

export const BACKGROUND_NOTIFICATIONS_UNSUPPORTED =
  'Update your desktop app to enable background notifications'

export type BackgroundNotificationsSectionProps = {
  /** True once some paired host advertised `notifications.remote-push.v1`. */
  supported: boolean
  /** False while every paired host is still being probed; renders nothing rather
   *  than telling someone to update a desktop that may well be current. */
  resolved: boolean
  enabled: boolean
  onToggleEnabled: (value: boolean) => void
}

export function BackgroundNotificationsSection({
  supported,
  resolved,
  enabled,
  onToggleEnabled
}: BackgroundNotificationsSectionProps) {
  if (!supported) {
    return resolved ? (
      <View style={styles.section}>
        <Text style={styles.unsupported}>{BACKGROUND_NOTIFICATIONS_UNSUPPORTED}</Text>
      </View>
    ) : null
  }

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Background notifications</Text>
        <Switch
          accessibilityLabel="Background notifications"
          value={enabled}
          onValueChange={onToggleEnabled}
          trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
          thumbColor={colors.textPrimary}
        />
      </View>
      <Text style={styles.hint}>{BACKGROUND_NOTIFICATIONS_HINT}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: spacing.md
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  subRow: {
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg + spacing.xs
  },
  rowLabel: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  subRowLabel: {
    fontWeight: '400',
    color: colors.textSecondary
  },
  hint: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    lineHeight: 18,
    paddingHorizontal: spacing.md + 2,
    paddingBottom: spacing.md
  },
  unsupported: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    lineHeight: 18,
    padding: spacing.md + 2
  }
})
