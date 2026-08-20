import { useState } from 'react'
import { View, Text, Pressable, TextInput, StyleSheet, Switch } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { colors, spacing, radii, typography } from '../theme/mobile-theme'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import {
  getQuickCommandAgentLabel,
  MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH,
  MAX_QUICK_COMMAND_LABEL_LENGTH,
  MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH
} from '../terminal/quick-commands'
import type { QuickCommandDraft } from './quick-command-draft'
import { isQuickCommandDraftValid } from './quick-command-draft'
import { translate } from '../i18n/i18n'

type Props = {
  draft: QuickCommandDraft
  mode: 'add' | 'edit'
  saving: boolean
  error: string | null
  // A mobile session lives in one repo, so "Project" scope means the current
  // worktree's repo — no cross-repo picker like desktop.
  repoId: string | null
  repoName: string | null
  onChange: (patch: Partial<QuickCommandDraft>) => void
  onOpenAgentPicker: () => void
  onCancel: () => void
  onSave: () => void
}

function ActionToggle({
  value,
  onChange
}: {
  value: QuickCommandDraft['action']
  onChange: (action: QuickCommandDraft['action']) => void
}) {
  return (
    <View style={styles.toggleGroup}>
      {(['terminal-command', 'agent-prompt'] as const).map((action) => {
        const selected = value === action
        return (
          <Pressable
            key={action}
            style={({ pressed }) => [
              styles.toggleItem,
              selected && styles.toggleItemSelected,
              pressed && !selected && styles.pressed
            ]}
            onPress={() => onChange(action)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.toggleText, selected && styles.toggleTextSelected]}>
              {action === 'terminal-command'
                ? translate(
                    'auto.mobile.src.session.QuickCommandEditorForm.f71933f074',
                    'Terminal Command'
                  )
                : translate(
                    'auto.mobile.src.session.QuickCommandEditorForm.0902b0f020',
                    'Agent Prompt'
                  )}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function QuickCommandEditorForm({
  draft,
  mode,
  saving,
  error,
  repoId,
  repoName,
  onChange,
  onOpenAgentPicker,
  onCancel,
  onSave
}: Props) {
  const hasRepoScope = repoId !== null
  const [advancedOpen, setAdvancedOpen] = useState(draft.scope.type === 'repo')
  const isAgent = draft.action === 'agent-prompt'
  const canSave = isQuickCommandDraftValid(draft) && !saving

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <Text style={styles.label}>
          {translate('auto.mobile.src.session.QuickCommandEditorForm.1973055270', 'Label')}
        </Text>
        <TextInput
          style={styles.input}
          value={draft.label}
          onChangeText={(label) => onChange({ label })}
          placeholder={translate(
            'auto.mobile.src.session.QuickCommandEditorForm.a5cab8c6d5',
            'Start dev server'
          )}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={MAX_QUICK_COMMAND_LABEL_LENGTH}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>
          {translate('auto.mobile.src.session.QuickCommandEditorForm.010e356a06', 'Action')}
        </Text>
        <ActionToggle value={draft.action} onChange={(action) => onChange({ action })} />
      </View>

      {isAgent ? (
        <View style={styles.field}>
          <Text style={styles.label}>
            {translate('auto.mobile.src.session.QuickCommandEditorForm.b61e388b60', 'Agent')}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.select, pressed && styles.pressed]}
            onPress={onOpenAgentPicker}
            accessibilityRole="button"
          >
            {draft.agent ? (
              <View style={styles.selectValue}>
                <MobileAgentIcon agentId={draft.agent} size={16} />
                <Text style={styles.selectValueText}>{getQuickCommandAgentLabel(draft.agent)}</Text>
              </View>
            ) : (
              <Text style={styles.selectPlaceholder}>
                {translate(
                  'auto.mobile.src.session.QuickCommandEditorForm.f43f688fae',
                  'Choose agent'
                )}
              </Text>
            )}
            <ChevronDown size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.label}>
          {isAgent
            ? translate('auto.mobile.src.session.QuickCommandEditorForm.bf9d7606a7', 'Prompt')
            : translate(
                'auto.mobile.src.session.QuickCommandEditorForm.d96528c298',
                'Command Text'
              )}
        </Text>
        <TextInput
          style={[styles.input, styles.textarea, !isAgent && styles.mono]}
          value={isAgent ? draft.prompt : draft.command}
          onChangeText={(text) => onChange(isAgent ? { prompt: text } : { command: text })}
          placeholder={
            isAgent
              ? translate(
                  'auto.mobile.src.session.QuickCommandEditorForm.8ffb968ee4',
                  'Ask the agent to investigate this workspace'
                )
              : translate(
                  'auto.mobile.src.session.QuickCommandEditorForm.606c52f1c9',
                  'npm run dev'
                )
          }
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          maxLength={
            isAgent ? MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH : MAX_QUICK_COMMAND_TERMINAL_TEXT_LENGTH
          }
        />
        {isAgent ? (
          <Text style={styles.hint}>
            {translate(
              'auto.mobile.src.session.QuickCommandEditorForm.5858a0a2a6',
              'Supports skills, file paths, and built-in commands.'
            )}
          </Text>
        ) : null}
      </View>

      <View style={styles.field}>
        <Pressable
          style={({ pressed }) => [styles.advancedToggle, pressed && styles.pressed]}
          onPress={() => setAdvancedOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
        >
          {advancedOpen ? (
            <ChevronDown size={16} color={colors.textSecondary} />
          ) : (
            <ChevronRight size={16} color={colors.textSecondary} />
          )}
          <Text style={styles.advancedText}>
            {translate('auto.mobile.src.session.QuickCommandEditorForm.32c24e1c38', 'Advanced')}
          </Text>
        </Pressable>

        {advancedOpen ? (
          <View style={styles.advancedBody}>
            {!isAgent ? (
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.switchTitle}>
                    {translate(
                      'auto.mobile.src.session.QuickCommandEditorForm.4bd5144a2f',
                      'Append Enter'
                    )}
                  </Text>
                  <Text style={styles.switchDesc}>
                    {translate(
                      'auto.mobile.src.session.QuickCommandEditorForm.8807475f6c',
                      'Submit immediately instead of only inserting text.'
                    )}{' '}
                  </Text>
                </View>
                <Switch
                  value={draft.appendEnter}
                  onValueChange={(appendEnter) => onChange({ appendEnter })}
                  trackColor={{ false: colors.bgRaised, true: colors.accentBlue }}
                  thumbColor={colors.surfaceBright}
                />
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>
                {translate('auto.mobile.src.session.QuickCommandEditorForm.255984f0ba', 'Scope')}
              </Text>
              <View style={styles.toggleGroup}>
                {(['global', 'repo'] as const).map((scopeType) => {
                  const selected = draft.scope.type === scopeType
                  const disabled = scopeType === 'repo' && !hasRepoScope
                  return (
                    <Pressable
                      key={scopeType}
                      disabled={disabled}
                      style={({ pressed }) => [
                        styles.toggleItem,
                        selected && styles.toggleItemSelected,
                        disabled && styles.toggleItemDisabled,
                        pressed && !selected && !disabled && styles.pressed
                      ]}
                      onPress={() =>
                        onChange({
                          scope:
                            scopeType === 'repo' && repoId
                              ? { type: 'repo', repoId }
                              : { type: 'global' }
                        })
                      }
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled }}
                    >
                      <Text style={[styles.toggleText, selected && styles.toggleTextSelected]}>
                        {scopeType === 'global'
                          ? translate(
                              'auto.mobile.src.session.QuickCommandEditorForm.b29057ca1c',
                              'Global'
                            )
                          : translate(
                              'auto.mobile.src.session.QuickCommandEditorForm.9c1d1f87e4',
                              'Project'
                            )}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              {draft.scope.type === 'repo' && repoName ? (
                <Text style={styles.scopeRepoName}>{repoName}</Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.cancelButton, pressed && styles.pressed]}
          onPress={onCancel}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>
            {translate('auto.mobile.src.session.QuickCommandEditorForm.cfd31efc92', 'Cancel')}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.saveButton, !canSave && styles.saveButtonDisabled]}
          disabled={!canSave}
          onPress={onSave}
          accessibilityRole="button"
        >
          <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>
            {mode === 'edit'
              ? translate('auto.mobile.src.session.QuickCommandEditorForm.4990252681', 'Save')
              : translate(
                  'auto.mobile.src.session.QuickCommandEditorForm.9abf0dd1c0',
                  'Add Quick Command'
                )}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  field: { gap: spacing.sm },
  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  input: {
    backgroundColor: colors.bgPanel,
    color: colors.textPrimary,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  textarea: { minHeight: 92, textAlignVertical: 'top' },
  mono: { fontFamily: typography.monoFamily },
  hint: { fontSize: 12, color: colors.textMuted },
  error: { fontSize: 13, color: colors.statusRed, marginTop: spacing.xs },
  pressed: { backgroundColor: colors.bgRaised },
  toggleGroup: { flexDirection: 'row', gap: spacing.sm },
  toggleItem: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    alignItems: 'center',
    justifyContent: 'center'
  },
  toggleItemSelected: { backgroundColor: colors.bgRaised, borderColor: colors.textMuted },
  toggleItemDisabled: { opacity: 0.4 },
  toggleText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  toggleTextSelected: { color: colors.textPrimary },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgPanel,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2
  },
  selectValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectValueText: { fontSize: 14, color: colors.textPrimary },
  selectPlaceholder: { fontSize: 14, color: colors.textMuted },
  scopeRepoName: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    paddingHorizontal: spacing.xs
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs
  },
  advancedText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  advancedBody: { gap: spacing.md, paddingTop: spacing.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchText: { flex: 1 },
  switchTitle: { fontSize: 14, color: colors.textPrimary },
  switchDesc: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  button: { flex: 1, borderRadius: 8, paddingVertical: spacing.md, alignItems: 'center' },
  cancelButton: { borderWidth: 1, borderColor: colors.borderSubtle },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  saveButton: { backgroundColor: colors.textPrimary },
  saveButtonDisabled: { backgroundColor: colors.bgRaised },
  saveText: { fontSize: 14, fontWeight: '700', color: colors.bgBase },
  saveTextDisabled: { color: colors.textMuted }
})
