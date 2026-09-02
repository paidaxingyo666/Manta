import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Languages } from 'lucide-react-native'
import { PickerModal, type PickerOption } from '../src/components/PickerModal'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'
import { setMobileUiLanguage, translate } from '../src/i18n/i18n'
import { localizedConstant } from '../src/i18n/localized-constant'
import { readUiLanguage, writeUiLanguage } from '../src/i18n/ui-language-store'
import {
  UI_LANGUAGE_CHINESE,
  UI_LANGUAGE_ENGLISH,
  UI_LANGUAGE_SYSTEM,
  type UiLanguage
} from '../../src/shared/ui-language'

// Each language names itself. A user who lands in a language they cannot read
// still has to find their way out of this list, so only the "system" row —
// which has no language of its own — follows the current UI language.
const languageOptions = localizedConstant((): PickerOption<UiLanguage>[] => [
  {
    value: UI_LANGUAGE_SYSTEM,
    label: translate('mobile.settings.language.system', 'Use device language'),
    subtitle: translate(
      'mobile.settings.language.systemSubtitle',
      'Follow the language set on this phone.'
    )
  },
  { value: UI_LANGUAGE_ENGLISH, label: 'English' }, // i18n-exempt: endonym
  { value: UI_LANGUAGE_CHINESE, label: '中文' } // i18n-exempt: endonym
])

function languageLabel(language: UiLanguage): string {
  return languageOptions().find((option) => option.value === language)?.label ?? 'English'
}

export default function LanguageSettingsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [language, setLanguage] = useState<UiLanguage>(UI_LANGUAGE_SYSTEM)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    void readUiLanguage().then(setLanguage)
  }, [])

  const selectLanguage = useCallback((next: UiLanguage) => {
    setLanguage(next)
    // Persist before applying: the language change remounts this screen, so a
    // write started after it can be cut short by the unmount.
    void writeUiLanguage(next).then(() => setMobileUiLanguage(next))
  }, [])

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          style={styles.backButton}
          accessibilityLabel={translate('mobile.settings.language.back', 'Back')}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>
          {translate('mobile.settings.language.heading', 'Language')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.groupHeading}>
          {translate('mobile.settings.language.groupHeading', 'DISPLAY LANGUAGE')}
        </Text>
        <Text style={styles.groupDescription}>
          {translate(
            'mobile.settings.language.groupDescription',
            'Changes what this app shows on this device. It does not change your desktop or anything an agent writes.'
          )}
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityLabel={translate('mobile.settings.language.rowLabel', 'App language')}
            onPress={() => setPickerOpen(true)}
          >
            <Languages size={16} color={colors.textSecondary} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>
                {translate('mobile.settings.language.rowLabel', 'App language')}
              </Text>
              <Text style={styles.rowSublabel}>{languageLabel(language)}</Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      </ScrollView>

      <PickerModal<UiLanguage>
        visible={pickerOpen}
        title={translate('mobile.settings.language.rowLabel', 'App language')}
        options={languageOptions()}
        selected={language}
        onSelect={selectLanguage}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.lg,
    paddingTop: 0
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary
  },
  scrollContent: {
    paddingBottom: spacing.xl
  },
  groupHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs
  },
  groupDescription: {
    fontSize: typography.bodySize - 1,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingHorizontal: spacing.xs
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  sectionTopGap: {
    marginTop: spacing.sm
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  rowContent: {
    flex: 1
  },
  rowLabel: {
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  rowSublabel: {
    fontSize: typography.bodySize - 2,
    color: colors.textSecondary,
    marginTop: 2
  }
})
