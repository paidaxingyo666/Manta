import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'

export type BrowserPointerModifier = 'cmd' | 'ctrl' | 'alt' | 'shift'

const browserPointerModifiers = localizedConstant(
  (): { id: BrowserPointerModifier; label: string }[] => [
    {
      id: 'cmd',
      label: translate('m.MobileBrowserPointerModifiers.216f31a789', 'Cmd')
    },
    {
      id: 'ctrl',
      label: translate('m.MobileBrowserPointerModifiers.12a5bc4ad4', 'Ctrl')
    },
    {
      id: 'alt',
      label: translate('m.MobileBrowserPointerModifiers.7cff3b4086', 'Alt')
    },
    {
      id: 'shift',
      label: translate('m.MobileBrowserPointerModifiers.1936cb6053', 'Shift')
    }
  ]
)

type Props = {
  disabled: boolean
  selectedModifiers: BrowserPointerModifier[]
  onToggle: (modifier: BrowserPointerModifier) => void
}

export function MobileBrowserPointerModifiers({
  disabled,
  selectedModifiers,
  onToggle
}: Props): React.JSX.Element {
  return (
    <View style={styles.modifierRow}>
      {browserPointerModifiers().map((modifier) => {
        const selected = selectedModifiers.includes(modifier.id)
        return (
          <Pressable
            key={modifier.id}
            style={({ pressed }) => [
              styles.keyButton,
              selected && styles.keyButtonSelected,
              pressed && !selected && styles.keyButtonPressed,
              disabled && styles.disabled
            ]}
            disabled={disabled}
            onPress={() => onToggle(modifier.id)}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${modifier.label} click modifier`}
          >
            <Text
              style={[
                styles.keyButtonText,
                selected && styles.keyButtonTextSelected,
                disabled && styles.disabledText
              ]}
            >
              {modifier.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  modifierRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs
  },
  keyButton: {
    minHeight: 30,
    minWidth: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.sm
  },
  keyButtonPressed: {
    backgroundColor: colors.borderSubtle
  },
  keyButtonSelected: {
    backgroundColor: colors.textPrimary
  },
  keyButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: typography.monoFamily
  },
  keyButtonTextSelected: {
    color: colors.bgBase
  },
  disabled: {
    opacity: 0.35
  },
  disabledText: {
    color: colors.textMuted
  }
})
