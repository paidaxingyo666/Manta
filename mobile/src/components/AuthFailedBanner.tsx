import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, spacing } from '../theme/mobile-theme'
import { translate } from '../i18n/i18n'

// Why: auth-failed is no longer necessarily terminal (issue #5200) — a
// transient rejection can latch it even though the desktop still lists this
// device. Offer Retry (fresh client + handshake) ahead of the disruptive
// re-pair flow so the common transient case recovers without re-pairing.
export function AuthFailedBanner({
  canRetry,
  onRetry,
  onRepair,
  onRemove
}: {
  canRetry: boolean
  onRetry: () => void
  onRepair: () => void
  onRemove: () => void
}) {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        {translate(
          'm.AuthFailedBanner.22b7ca421f',
          'Authentication failed — try reconnecting first; if it keeps failing, re-pair from desktop.'
        )}{' '}
      </Text>
      <View style={styles.actions}>
        {canRetry && (
          <Pressable style={styles.action} onPress={onRetry}>
            <Text style={styles.actionText}>
              {translate('m.AuthFailedBanner.ba389e71e9', 'Retry')}
            </Text>
          </Pressable>
        )}
        <Pressable style={styles.action} onPress={onRepair}>
          <Text style={styles.actionText}>
            {translate('m.AuthFailedBanner.2aea91f056', 'Re-pair')}
          </Text>
        </Pressable>
        <Pressable style={styles.action} onPress={onRemove}>
          <Text style={[styles.actionText, { color: colors.statusRed }]}>
            {translate('m.AuthFailedBanner.abe30d9dde', 'Remove')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.bgPanel,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  text: {
    color: colors.statusRed,
    fontSize: 13,
    marginBottom: spacing.sm
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg
  },
  action: {
    paddingVertical: spacing.xs
  },
  actionText: {
    color: colors.accentBlue,
    fontSize: 13,
    fontWeight: '600'
  }
})
