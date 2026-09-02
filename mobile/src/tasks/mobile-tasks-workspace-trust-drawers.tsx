import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import {
  BottomDrawer,
  View,
  Text,
  TextInput,
  colors,
  Pressable,
  ActivityIndicator,
  Check,
  X
} from './mobile-tasks-dependencies'
import { TASK_SECONDARY_DRAWER_Z_INDEX, setupSourceLabel } from './mobile-tasks-legacy-foundation'
import { styles } from './mobile-tasks-legacy-styles'
import { translate } from '../i18n/i18n'

export function renderMobileTasksWorkspaceSparseDrawer(model: ConnectionPresentationModel) {
  const {
    canSaveWorkspaceSparseDraft,
    saveWorkspaceSparsePreset,
    setWorkspaceSparseDraft,
    taskUiReady,
    workspaceCreateDraft,
    workspaceSparseDraft,
    workspaceSparseDraftError,
    workspaceSparseDraftParsed,
    workspaceSparseSaving
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && workspaceCreateDraft != null && workspaceSparseDraft != null}
      onClose={() => {
        if (!workspaceSparseSaving) {
          setWorkspaceSparseDraft(null)
        }
      }}
      zIndex={TASK_SECONDARY_DRAWER_Z_INDEX + 2}
    >
      {workspaceSparseDraft ? (
        <View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {workspaceSparseDraft.mode === 'new'
                ? translate('m.tasks.9ba7ca6a72', 'New Sparse Preset')
                : translate('m.tasks.6a5da1393a', 'Edit Sparse Preset')}
            </Text>
          </View>
          <View style={styles.detailGroup}>
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>
                {translate('m.tasks.edd08de8b9', 'Name')}
              </Text>
              <TextInput
                style={styles.input}
                value={workspaceSparseDraft.name}
                onChangeText={(name) => setWorkspaceSparseDraft({ ...workspaceSparseDraft, name })}
                placeholder={translate('m.tasks.a21f24f4c3', 'Renderer UI')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={80}
              />
            </View>
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>
                {translate('m.tasks.721916c122', 'Directories')}
              </Text>
              <TextInput
                style={[styles.input, styles.bodyInput, styles.monoInput]}
                value={workspaceSparseDraft.directoriesText}
                onChangeText={(directoriesText) =>
                  setWorkspaceSparseDraft({ ...workspaceSparseDraft, directoriesText })
                }
                placeholder={translate('m.tasks.83698fde61', 'src/renderer packages/ui')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                textAlignVertical="top"
              />
            </View>
            <Text style={workspaceSparseDraftError ? styles.detailError : styles.detailMuted}>
              {workspaceSparseDraftError ??
                (workspaceSparseDraftParsed?.directories.length === 1
                  ? translate('m.tasks.0efb8013dd', '1 directory')
                  : translate('m.tasks.a63af13a45', '{{value0}} directories', {
                      value0: workspaceSparseDraftParsed?.directories.length ?? 0
                    }))}
            </Text>
          </View>
          <View style={styles.drawerActionRow}>
            <Pressable
              style={styles.secondaryActionButton}
              disabled={workspaceSparseSaving}
              onPress={() => setWorkspaceSparseDraft(null)}
            >
              <Text style={styles.secondaryActionText}>
                {translate('m.tasks.16fee5cb7d', 'Cancel')}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryActionButton,
                !canSaveWorkspaceSparseDraft ? styles.fieldButtonDisabled : undefined
              ]}
              disabled={!canSaveWorkspaceSparseDraft}
              onPress={() => void saveWorkspaceSparsePreset()}
            >
              {workspaceSparseSaving ? (
                <ActivityIndicator size="small" color={colors.bgBase} />
              ) : null}
              <Text style={styles.primaryActionText}>
                {translate('m.tasks.c7158b292f', 'Save')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </BottomDrawer>
  )
}

export function renderMobileTasksSetupTrustDrawer(model: ConnectionPresentationModel) {
  const { createWorkspace, creatingKey, setSetupPrompt, setupPrompt, taskUiReady } = model
  return (
    <BottomDrawer
      visible={taskUiReady && setupPrompt != null}
      onClose={() => setSetupPrompt(null)}
      zIndex={TASK_SECONDARY_DRAWER_Z_INDEX + 1}
    >
      {setupPrompt ? (
        <View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {translate('m.tasks.374a5075f8', 'Run Setup Script?')}
            </Text>
            <Text style={styles.sheetSubtitle}>
              {setupPrompt.repoName}{' '}
              {translate(
                'm.tasks.caf1f1c3f9',
                'requires a setup choice before creating this workspace.'
              )}{' '}
            </Text>
          </View>

          <View style={styles.setupPromptBox}>
            <View style={styles.detailSectionHeader}>
              <Text style={styles.detailSectionTitle}>{setupSourceLabel(setupPrompt.source)}</Text>
            </View>
            <Text style={styles.setupPromptCommand}>{setupPrompt.command}</Text>
          </View>

          <View style={styles.actionGroup}>
            <Pressable
              style={styles.actionRow}
              disabled={creatingKey === setupPrompt.item.key}
              onPress={() =>
                void createWorkspace(
                  setupPrompt.item,
                  setupPrompt.repoIdOverride,
                  'run',
                  setupPrompt.agentOverride,
                  setupPrompt.workspaceNameOverride,
                  setupPrompt.noteOverride,
                  setupPrompt.baseBranchOverride,
                  setupPrompt.branchNameOverride,
                  setupPrompt.sparseCheckoutOverride
                )
              }
            >
              <Check size={16} color={colors.textPrimary} />
              <Text style={styles.actionText}>
                {creatingKey === setupPrompt.item.key
                  ? translate('m.tasks.7ed22602e7', 'Creating...')
                  : translate('m.tasks.6f4021e6d8', 'Run setup and create')}
              </Text>
            </Pressable>
            <View style={styles.actionSeparator} />
            <Pressable
              style={styles.actionRow}
              disabled={creatingKey === setupPrompt.item.key}
              onPress={() =>
                void createWorkspace(
                  setupPrompt.item,
                  setupPrompt.repoIdOverride,
                  'skip',
                  setupPrompt.agentOverride,
                  setupPrompt.workspaceNameOverride,
                  setupPrompt.noteOverride,
                  setupPrompt.baseBranchOverride,
                  setupPrompt.branchNameOverride,
                  setupPrompt.sparseCheckoutOverride
                )
              }
            >
              <X size={16} color={colors.textPrimary} />
              <Text style={styles.actionText}>
                {translate('m.tasks.c5dd55b98b', 'Skip setup and create')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </BottomDrawer>
  )
}

export function renderMobileTasksMantaYamlTrustDrawer(model: ConnectionPresentationModel) {
  const {
    createWorkspace,
    creatingKey,
    mantaYamlTrustPrompt,
    persistSetupHookTrust,
    setError,
    setMantaYamlTrustPrompt,
    taskUiReady
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && mantaYamlTrustPrompt != null}
      onClose={() => setMantaYamlTrustPrompt(null)}
      zIndex={TASK_SECONDARY_DRAWER_Z_INDEX + 1}
    >
      {mantaYamlTrustPrompt ? (
        <View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {mantaYamlTrustPrompt.previouslyApproved
                ? translate('m.tasks.41eb5d08a7', "{{value0}}'s setup script changed", {
                    value0: mantaYamlTrustPrompt.repoName
                  })
                : translate('m.tasks.33f3eab28c', 'Run setup from {{value0}}?', {
                    value0: mantaYamlTrustPrompt.repoName
                  })}
            </Text>
            <Text style={styles.sheetSubtitle}>
              {translate(
                'm.tasks.0067e101da',
                "This repository's manta.yaml runs on your machine before the workspace starts. Only run it if you trust this repository."
              )}{' '}
            </Text>
          </View>

          <View style={styles.setupPromptBox}>
            <View style={styles.detailSectionHeader}>
              <Text style={styles.detailSectionTitle}>
                {mantaYamlTrustPrompt.previouslyApproved
                  ? translate('m.tasks.bed7484165', 'New setup script')
                  : translate('m.tasks.5cfbadc7ae', 'Setup script')}
              </Text>
            </View>
            <Text style={styles.setupPromptCommand}>{mantaYamlTrustPrompt.scriptContent}</Text>
          </View>

          <View style={styles.actionGroup}>
            <Pressable
              style={styles.actionRow}
              disabled={creatingKey === mantaYamlTrustPrompt.item.key}
              onPress={() =>
                void (async () => {
                  try {
                    await persistSetupHookTrust(
                      mantaYamlTrustPrompt.repoId,
                      mantaYamlTrustPrompt.contentHash,
                      false
                    )
                    setMantaYamlTrustPrompt(null)
                    await createWorkspace(
                      mantaYamlTrustPrompt.item,
                      mantaYamlTrustPrompt.repoIdOverride,
                      'run',
                      mantaYamlTrustPrompt.agentOverride,
                      mantaYamlTrustPrompt.workspaceNameOverride,
                      mantaYamlTrustPrompt.noteOverride,
                      mantaYamlTrustPrompt.baseBranchOverride,
                      mantaYamlTrustPrompt.branchNameOverride,
                      mantaYamlTrustPrompt.sparseCheckoutOverride,
                      mantaYamlTrustPrompt.contentHash
                    )
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to trust setup script.')
                  }
                })()
              }
            >
              <Check size={16} color={colors.textPrimary} />
              <Text style={styles.actionText}>{translate('m.tasks.9be7d57af4', 'Run hooks')}</Text>
            </Pressable>
            <View style={styles.actionSeparator} />
            <Pressable
              style={styles.actionRow}
              disabled={creatingKey === mantaYamlTrustPrompt.item.key}
              onPress={() =>
                void (async () => {
                  try {
                    await persistSetupHookTrust(
                      mantaYamlTrustPrompt.repoId,
                      mantaYamlTrustPrompt.contentHash,
                      true
                    )
                    setMantaYamlTrustPrompt(null)
                    await createWorkspace(
                      mantaYamlTrustPrompt.item,
                      mantaYamlTrustPrompt.repoIdOverride,
                      'run',
                      mantaYamlTrustPrompt.agentOverride,
                      mantaYamlTrustPrompt.workspaceNameOverride,
                      mantaYamlTrustPrompt.noteOverride,
                      mantaYamlTrustPrompt.baseBranchOverride,
                      mantaYamlTrustPrompt.branchNameOverride,
                      mantaYamlTrustPrompt.sparseCheckoutOverride,
                      mantaYamlTrustPrompt.contentHash
                    )
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to trust setup script.')
                  }
                })()
              }
            >
              <Check size={16} color={colors.textPrimary} />
              <Text style={styles.actionText}>
                {translate('m.tasks.965cfe1733', 'Always trust and run')}
              </Text>
            </Pressable>
            <View style={styles.actionSeparator} />
            <Pressable
              style={styles.actionRow}
              disabled={creatingKey === mantaYamlTrustPrompt.item.key}
              onPress={() => {
                const prompt = mantaYamlTrustPrompt
                setMantaYamlTrustPrompt(null)
                void createWorkspace(
                  prompt.item,
                  prompt.repoIdOverride,
                  'skip',
                  prompt.agentOverride,
                  prompt.workspaceNameOverride,
                  prompt.noteOverride,
                  prompt.baseBranchOverride,
                  prompt.branchNameOverride,
                  prompt.sparseCheckoutOverride
                )
              }}
            >
              <X size={16} color={colors.textPrimary} />
              <Text style={styles.actionText}>{translate('m.tasks.78dc8d99b5', "Don't run")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </BottomDrawer>
  )
}
