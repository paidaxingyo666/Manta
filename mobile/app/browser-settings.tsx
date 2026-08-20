import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Globe } from 'lucide-react-native'
import { PickerModal, type PickerOption } from '../src/components/PickerModal'
import {
  loadTerminalLinkOpenMode,
  saveTerminalLinkOpenMode,
  type MobileTerminalLinkOpenMode
} from '../src/storage/preferences'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'
import { translate } from '../src/i18n/i18n'
import { localizedConstant } from '../src/i18n/localized-constant'

const linkModeOptions = localizedConstant((): PickerOption<MobileTerminalLinkOpenMode>[] => [
  {
    value: 'manta-browser',
    label: translate('m.browser.settings.2307073d4f', 'Manta browser on desktop'),
    subtitle: translate(
      'm.browser.settings.678f6766a4',
      'Open in the streamed browser from your paired desktop.'
    )
  },
  {
    value: 'phone-browser',
    label: translate('m.browser.settings.848a3a5e01', 'Phone browser'),
    subtitle: translate(
      'm.browser.settings.5a3e904671',
      'Open in Safari, Chrome, or another browser on this phone.'
    )
  }
])

function linkModeLabel(mode: MobileTerminalLinkOpenMode): string {
  return (
    linkModeOptions().find((option) => option.value === mode)?.label ?? linkModeOptions()[0]!.label
  )
}

export default function BrowserSettingsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [linkMode, setLinkMode] = useState<MobileTerminalLinkOpenMode>('manta-browser')
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    void loadTerminalLinkOpenMode().then(setLinkMode)
  }, [])

  const selectLinkMode = useCallback((mode: MobileTerminalLinkOpenMode) => {
    setLinkMode(mode)
    void saveTerminalLinkOpenMode(mode)
  }, [])

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>{translate('m.browser.settings.189c0c35a9', 'Browser')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.groupHeading}>
          {translate('m.browser.settings.821ed56937', 'LINKS')}
        </Text>
        <Text style={styles.groupDescription}>
          {translate(
            'm.browser.settings.2ba554fba7',
            'Choose where HTTP(S) links tapped in terminal output open.'
          )}{' '}
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setPickerOpen(true)}
          >
            <Globe size={16} color={colors.textSecondary} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>
                {translate('m.browser.settings.c1dc8b0975', 'Open terminal links')}
              </Text>
              <Text style={styles.rowSublabel}>{linkModeLabel(linkMode)}</Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      </ScrollView>

      <PickerModal<MobileTerminalLinkOpenMode>
        visible={pickerOpen}
        title={translate('m.browser.settings.c1dc8b0975', 'Open terminal links')}
        options={linkModeOptions()}
        selected={linkMode}
        onSelect={selectLinkMode}
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
