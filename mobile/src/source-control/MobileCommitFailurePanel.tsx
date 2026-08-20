import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import type { MobileCommitFailureRecovery } from './mobile-commit-failure-recovery'
import type { MobileCommitFailureRecoveryAction } from './use-mobile-commit-failure-recovery'
import { styles } from './mobile-source-control-styles'
import { translate } from '../i18n/i18n'

type Props = {
  failure: MobileCommitFailureRecovery
  action: MobileCommitFailureRecoveryAction
}

export function MobileCommitFailurePanel({ failure, action }: Props) {
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight
  const detailsText = failure.error.trim()

  return (
    <View style={styles.commitFailurePanel}>
      <View style={styles.commitFailureHeader}>
        <View style={styles.commitFailureTextBlock}>
          <Text style={styles.commitFailureTitle}>
            {translate('m.MobileCommitFailurePanel.1e8978aed2', 'Commit failed')}
          </Text>
          <Text style={styles.commitFailureSummary} numberOfLines={2}>
            {action.summary ?? translate('m.MobileCommitFailurePanel.aab7681cb3', 'Commit failed.')}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.commitFailureFixButton,
            action.launching && styles.commitFailureFixButtonDisabled,
            pressed && styles.commitFailureFixButtonPressed
          ]}
          onPress={() => void action.launch()}
          disabled={action.launching}
          accessibilityRole="button"
          accessibilityLabel="Fix commit failure with AI"
        >
          {action.launching ? (
            <ActivityIndicator color={colors.bgBase} />
          ) : (
            <Sparkles size={14} color={colors.bgBase} strokeWidth={2.2} />
          )}
          <Text style={styles.commitFailureFixButtonText}>
            {translate('m.MobileCommitFailurePanel.f916c423a3', 'Fix')}
          </Text>
        </Pressable>
      </View>
      {action.hasDetails && detailsText ? (
        <>
          <Pressable
            style={({ pressed }) => [
              styles.commitFailureDetailsButton,
              pressed && styles.commitFailureDetailsButtonPressed
            ]}
            onPress={() => setExpanded((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={
              expanded ? 'Hide commit failure details' : 'Show commit failure details'
            }
          >
            <Chevron size={14} color={colors.textSecondary} strokeWidth={2.2} />
            <Text style={styles.commitFailureDetailsButtonText}>
              {expanded
                ? translate('m.MobileCommitFailurePanel.7b2b0ff9f2', 'Hide details')
                : translate('m.MobileCommitFailurePanel.3f67db6ee8', 'Show details')}
            </Text>
          </Pressable>
          {expanded ? <Text style={styles.commitFailureDetailsText}>{detailsText}</Text> : null}
        </>
      ) : null}
      {action.launchError ? (
        <Text style={styles.commitFailureLaunchError}>{action.launchError}</Text>
      ) : null}
    </View>
  )
}
