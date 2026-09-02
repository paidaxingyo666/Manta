import { Pressable, Switch, Text, View } from 'react-native'
import type { WorkspaceCreateSetupDecision } from '../tasks/workspace-create-params'
import { colors } from '../theme/mobile-theme'
import { newWorktreeFormStyles as styles } from './new-worktree-form-styles'
import type { SetupRunPolicy } from './new-worktree-modal-types'
import { translate } from '../i18n/i18n'

export function NewWorkspaceSetupScriptField({
  command,
  source,
  runPolicy,
  decision,
  runSetup,
  onDecisionChange,
  onRunSetupChange
}: {
  command: string
  source: string | null
  runPolicy: SetupRunPolicy
  decision: Exclude<WorkspaceCreateSetupDecision, 'inherit'> | null
  runSetup: boolean
  onDecisionChange: (decision: Exclude<WorkspaceCreateSetupDecision, 'inherit'>) => void
  onRunSetupChange: (run: boolean) => void
}) {
  return (
    <View style={styles.field}>
      <View style={styles.setupHeader}>
        <Text style={styles.label}>
          {translate('m.NewWorktreeModal.d1c6e46d31', 'Setup script')}
        </Text>
        {source ? (
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>
              {source === 'manta.yaml'
                ? translate('m.NewWorktreeModal.2c40d1cbfe', 'MANTA.YAML')
                : translate('m.NewWorktreeModal.f1c9144d48', 'HOOKS')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.setupBox}>
        {runPolicy === 'ask' ? (
          <View style={styles.setupChoiceRow}>
            <Pressable
              style={[
                styles.setupChoiceButton,
                decision === 'run' && styles.setupChoiceButtonSelected
              ]}
              onPress={() => onDecisionChange('run')}
            >
              <Text style={styles.setupChoiceText}>
                {translate('m.NewWorktreeModal.d2a6322022', 'Run')}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.setupChoiceButton,
                decision === 'skip' && styles.setupChoiceButtonSelected
              ]}
              onPress={() => onDecisionChange('skip')}
            >
              <Text style={styles.setupChoiceText}>
                {translate('m.NewWorktreeModal.b191daf935', 'Skip')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.setupToggleRow}>
            <Text style={styles.setupToggleLabel}>
              {translate('m.NewWorktreeModal.a1b2e6ce4c', 'Run setup command')}
            </Text>
            <Switch
              value={runSetup}
              onValueChange={onRunSetupChange}
              trackColor={{ false: colors.borderSubtle, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
              style={styles.setupSwitch}
            />
          </View>
        )}
        <View style={styles.setupCommandBlock}>
          <Text style={styles.setupCommand}>{command}</Text>
        </View>
      </View>
    </View>
  )
}
