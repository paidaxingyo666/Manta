import { Settings } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MantaLogo } from '../components/MantaLogo'
import { colors, spacing } from '../theme/mobile-theme'

export function MobileHomeTopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <View style={styles.topBar}>
      <View style={styles.brandLockup}>
        <View style={styles.logoMark}>
          <MantaLogo size={18} />
        </View>
        <Text style={styles.brandName}>Manta</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        onPress={onOpenSettings}
      >
        <Settings size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md
  },
  brandLockup: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  logoMark: { marginRight: spacing.sm },
  brandName: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonPressed: { backgroundColor: colors.bgRaised }
})
