import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import type { CompatVerdict } from '../transport/protocol-compat'
import { translate } from '../i18n/i18n'

const RELEASES_URL = 'https://github.com/stablyai/manta/releases'
const IOS_APP_STORE_URL = 'itms-apps://apps.apple.com/app/orca-ide/id6766130217'

type Props = {
  verdict: Extract<CompatVerdict, { kind: 'blocked' }>
}

export function ProtocolBlockScreen({ verdict }: Props) {
  const isMobileTooOld = verdict.reason === 'mobile-too-old'
  // Why: Android APKs ship through GitHub Releases until a Play Store listing exists.
  const mobileUpdateTarget =
    Platform.OS === 'ios'
      ? {
          label: translate(
            'auto.mobile.src.components.ProtocolBlockScreen.a31839553b',
            'Open App Store'
          ),
          url: IOS_APP_STORE_URL,
          storeName: 'the App Store'
        }
      : {
          label: translate(
            'auto.mobile.src.components.ProtocolBlockScreen.8776701afd',
            'Open GitHub Releases'
          ),
          url: RELEASES_URL,
          storeName: 'GitHub Releases'
        }
  const primaryAction = isMobileTooOld
    ? { label: mobileUpdateTarget.label, url: mobileUpdateTarget.url }
    : {
        label: translate(
          'auto.mobile.src.components.ProtocolBlockScreen.8776701afd',
          'Open GitHub Releases'
        ),
        url: RELEASES_URL
      }

  const title = isMobileTooOld
    ? translate('auto.mobile.src.components.ProtocolBlockScreen.682bbfb813', 'Update Manta Mobile')
    : translate(
        'auto.mobile.src.components.ProtocolBlockScreen.0b8f38e4de',
        'Update Manta on your computer'
      )
  const body = isMobileTooOld
    ? translate(
        'auto.mobile.src.components.ProtocolBlockScreen.938a1a102b',
        'This desktop needs a newer Manta Mobile app. Update Manta Mobile from {{value0}}, then try this host again.',
        { value0: mobileUpdateTarget.storeName }
      )
    : translate(
        'auto.mobile.src.components.ProtocolBlockScreen.09c9f2cce4',
        'This paired desktop app is too old for your current Manta Mobile app. Update Manta on your computer, then try this host again.'
      )
  const recoveryNote = translate(
    'auto.mobile.src.components.ProtocolBlockScreen.d990a3a921',
    'Already updated? Go back to Hosts and refresh the connection. If this message stays, remove this host and pair it again.'
  )

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => {
            void Linking.openURL(primaryAction.url)
          }}
        >
          <Text style={styles.primaryButtonText}>{primaryAction.label}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => {
            // Why: route back to the host list so the user can pair a
            // different host instead of getting trapped on this screen.
            router.replace('/')
          }}
        >
          <Text style={styles.secondaryButtonText}>
            {translate(
              'auto.mobile.src.components.ProtocolBlockScreen.900fceb931',
              'Back to hosts'
            )}
          </Text>
        </Pressable>
        <Text style={styles.recoveryNote}>{recoveryNote}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  title: {
    fontSize: typography.titleSize,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm
  },
  body: {
    fontSize: typography.bodySize,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.lg
  },
  primaryButton: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.button,
    alignItems: 'center',
    marginBottom: spacing.sm
  },
  primaryButtonText: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.bgBase
  },
  secondaryButton: {
    backgroundColor: colors.bgRaised,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.button,
    alignItems: 'center'
  },
  secondaryButtonText: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  recoveryNote: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.md
  },
  pressed: {
    opacity: 0.7
  }
})
