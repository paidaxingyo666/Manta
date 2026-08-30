import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import {
  BottomDrawer,
  View,
  Text,
  Pressable,
  ChevronDown,
  colors,
  workspaceSshStatusLabel,
  MobileWorkspaceNameInput,
  MobileAgentIcon,
  workspaceAgentLabel,
  ChevronUp,
  GitBranch,
  ActivityIndicator,
  PickerModal
} from './mobile-tasks-dependencies'
import {
  TASK_SECONDARY_DRAWER_Z_INDEX,
  getRepoBadgeColor,
  workspaceAgentIconId
} from './mobile-tasks-legacy-foundation'
import { styles } from './mobile-tasks-legacy-styles'
import { translate } from '../i18n/i18n'

export function renderMobileTasksWorkspaceCreateDrawer(model: ConnectionPresentationModel) {
  const {
    connectWorkspaceSshRepo,
    createWorkspace,
    creatingKey,
    handleWorkspaceNameDraftChange,
    resolvedWorkspaceAgent,
    setShowWorkspaceAdvanced,
    setShowWorkspaceAgentPicker,
    setShowWorkspaceBaseBranchPicker,
    setShowWorkspaceCreateRepoPicker,
    setWorkspaceBaseBranchQuery,
    setWorkspaceCreateDraft,
    showWorkspaceAdvanced,
    taskUiReady,
    workspaceAgentDetectionPending,
    workspaceBaseBranch,
    workspaceBranchAutoName,
    workspaceBranchNameOverride,
    workspaceCreateCanPickRepo,
    workspaceCreateDraft,
    workspaceCreateRequiresSshConnection,
    workspaceCreateSshConnectInProgress,
    workspaceCreateSshError,
    workspaceCreateSshStatus,
    workspaceCreateTargetConnectionId,
    workspaceCreateTargetRepo,
    workspaceNameDraft
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && workspaceCreateDraft != null}
      onClose={() => setWorkspaceCreateDraft(null)}
      zIndex={TASK_SECONDARY_DRAWER_Z_INDEX}
    >
      {workspaceCreateDraft ? (
        <View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {translate('m.tasks.d783b7fb2b', 'Create Workspace')}
            </Text>
            <Text style={styles.sheetSubtitle} numberOfLines={2}>
              {workspaceCreateDraft.item.title}
            </Text>
          </View>

          <View style={styles.workspaceCreateForm}>
            <View style={styles.workspaceCreateField}>
              <Text style={styles.workspaceCreateLabel}>
                {translate('m.tasks.4414bc388e', 'Repository')}
              </Text>
              <Pressable
                style={styles.fieldButton}
                disabled={!workspaceCreateCanPickRepo}
                onPress={() => setShowWorkspaceCreateRepoPicker(true)}
              >
                {workspaceCreateTargetRepo ? (
                  <View
                    style={[
                      styles.pickerRepoDot,
                      {
                        backgroundColor: getRepoBadgeColor(
                          workspaceCreateTargetRepo,
                          workspaceCreateTargetRepo.displayName
                        )
                      }
                    ]}
                  />
                ) : null}
                <Text
                  style={[
                    styles.fieldButtonText,
                    !workspaceCreateTargetRepo ? styles.fieldButtonPlaceholder : undefined
                  ]}
                  numberOfLines={1}
                >
                  {workspaceCreateTargetRepo?.displayName ??
                    translate('m.tasks.983b6e3640', 'Select a repository')}
                </Text>
                {workspaceCreateCanPickRepo ? (
                  <ChevronDown size={14} color={colors.textMuted} />
                ) : null}
              </Pressable>
            </View>

            {workspaceCreateTargetConnectionId ? (
              <View style={styles.workspaceCreateField}>
                <Text style={styles.workspaceCreateLabel}>
                  {translate('m.tasks.85c9744a6b', 'SSH Connection')}
                </Text>
                <View style={styles.sshConnectCard}>
                  <View style={styles.sshStatusRow}>
                    <View
                      style={[
                        styles.sshStatusDot,
                        workspaceCreateSshStatus === 'connected'
                          ? styles.sshStatusDotConnected
                          : workspaceCreateSshConnectInProgress
                            ? styles.sshStatusDotProgress
                            : styles.sshStatusDotDisconnected
                      ]}
                    />
                    <View style={styles.sshStatusCopy}>
                      <Text style={styles.sshStatusTitle} numberOfLines={1}>
                        {workspaceCreateTargetRepo?.displayName ??
                          translate('m.tasks.1262746690', 'Remote repository')}
                      </Text>
                      <Text style={styles.detailMuted}>
                        {workspaceSshStatusLabel(workspaceCreateSshStatus)}
                      </Text>
                    </View>
                    {workspaceCreateSshStatus === 'connected' ? null : (
                      <Pressable
                        style={[
                          styles.inlineSaveButtonCompact,
                          workspaceCreateSshConnectInProgress
                            ? styles.fieldButtonDisabled
                            : undefined
                        ]}
                        disabled={workspaceCreateSshConnectInProgress}
                        onPress={() => void connectWorkspaceSshRepo()}
                      >
                        <Text style={styles.inlineSaveText}>
                          {workspaceCreateSshConnectInProgress
                            ? translate('m.tasks.1c8722f002', 'Connecting...')
                            : translate('m.tasks.783ad5427a', 'Connect')}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  {workspaceCreateSshError ? (
                    <Text style={styles.detailError}>{workspaceCreateSshError}</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={styles.workspaceCreateField}>
              <Text style={styles.workspaceCreateLabel}>
                {translate('m.tasks.9ebfab9a70', 'Workspace Name')}{' '}
                <Text style={styles.workspaceCreateLabelHint}>
                  {translate('m.tasks.e544525736', '[Optional]')}
                </Text>
              </Text>
              <MobileWorkspaceNameInput
                style={styles.input}
                value={workspaceNameDraft}
                onChangeText={handleWorkspaceNameDraftChange}
                placeholderTextColor={colors.textMuted}
                shouldAutoFocus={taskUiReady && workspaceCreateDraft !== null}
              />
            </View>

            <View style={styles.workspaceCreateField}>
              <Text style={styles.workspaceCreateLabel}>
                {translate('m.tasks.c03eedc8a5', 'Agent')}
              </Text>
              <Pressable
                style={[
                  styles.fieldButton,
                  workspaceCreateRequiresSshConnection ? styles.fieldButtonDisabled : undefined
                ]}
                disabled={workspaceCreateRequiresSshConnection}
                onPress={() => setShowWorkspaceAgentPicker(true)}
              >
                <MobileAgentIcon agentId={workspaceAgentIconId(resolvedWorkspaceAgent)} size={16} />
                <Text style={styles.fieldButtonText} numberOfLines={1}>
                  {workspaceCreateRequiresSshConnection
                    ? translate('m.tasks.4913f49b39', 'Connect repository first')
                    : workspaceAgentDetectionPending
                      ? translate('m.tasks.a6154f9f64', 'Detecting agents...')
                      : workspaceAgentLabel(resolvedWorkspaceAgent)}
                </Text>
                <ChevronDown size={14} color={colors.textMuted} />
              </Pressable>
            </View>

            <Pressable
              style={styles.workspaceAdvancedToggle}
              onPress={() => setShowWorkspaceAdvanced((current) => !current)}
            >
              <Text style={styles.workspaceAdvancedText}>
                {translate('m.tasks.f0f0ead5de', 'Advanced')}
              </Text>
              {showWorkspaceAdvanced ? (
                <ChevronUp size={14} color={colors.textSecondary} />
              ) : (
                <ChevronDown size={14} color={colors.textSecondary} />
              )}
            </Pressable>

            {showWorkspaceAdvanced ? (
              <View style={styles.workspaceCreateField}>
                <Text style={styles.workspaceCreateLabel}>
                  {translate('m.tasks.9da82058be', 'Start from')}
                </Text>
                <Pressable
                  style={styles.fieldButton}
                  onPress={() => {
                    setWorkspaceBaseBranchQuery(workspaceBaseBranch?.refName ?? '')
                    setShowWorkspaceBaseBranchPicker(true)
                  }}
                >
                  <GitBranch size={14} color={colors.textMuted} />
                  <Text style={styles.fieldButtonText} numberOfLines={1}>
                    {workspaceBaseBranch?.refName ??
                      translate('m.tasks.b498493084', 'Default branch')}
                  </Text>
                  <ChevronDown size={14} color={colors.textMuted} />
                </Pressable>
                {workspaceBaseBranch ? (
                  <Text style={styles.detailMuted} numberOfLines={1}>
                    {translate('m.tasks.6b511d62d0', 'Create from')}
                    {workspaceBaseBranch.refName}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {workspaceCreateTargetRepo ? null : (
            <Text style={styles.detailError}>
              {workspaceCreateDraft.item.provider === 'linear'
                ? translate(
                    'm.tasks.ea42a21b65',
                    'Add a Git repository before creating a Linear workspace.'
                  )
                : translate('m.tasks.e05fff6416', 'Repository not found.')}
            </Text>
          )}

          <View style={styles.workspaceCreateActions}>
            <Pressable
              style={[
                styles.createButton,
                styles.workspaceCreateButton,
                (!workspaceCreateTargetRepo ||
                  workspaceCreateRequiresSshConnection ||
                  workspaceAgentDetectionPending ||
                  creatingKey === workspaceCreateDraft.item.key) &&
                  styles.createButtonDisabled
              ]}
              disabled={
                !workspaceCreateTargetRepo ||
                workspaceCreateRequiresSshConnection ||
                workspaceAgentDetectionPending ||
                creatingKey === workspaceCreateDraft.item.key
              }
              onPress={() => {
                // Why: this compact issue-to-workspace flow should match the
                // basic create workspace path; sparse checkout can return later.
                void createWorkspace(
                  workspaceCreateDraft.item,
                  workspaceCreateDraft.repoIdOverride,
                  undefined,
                  resolvedWorkspaceAgent,
                  workspaceNameDraft.trim(),
                  undefined,
                  workspaceBaseBranch?.refName,
                  workspaceBranchNameOverride &&
                    workspaceNameDraft.trim() === workspaceBranchAutoName
                    ? workspaceBranchNameOverride
                    : undefined,
                  undefined
                )
              }}
            >
              {creatingKey === workspaceCreateDraft.item.key ? (
                <ActivityIndicator size="small" color={colors.bgBase} />
              ) : (
                <Text style={styles.createButtonText}>
                  {workspaceAgentDetectionPending
                    ? translate('m.tasks.a6154f9f64', 'Detecting agents...')
                    : workspaceCreateRequiresSshConnection
                      ? translate('m.tasks.49639216d6', 'Connect Repository')
                      : translate('m.tasks.d783b7fb2b', 'Create Workspace')}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}
    </BottomDrawer>
  )
}

export function renderMobileTasksWorkspaceCreateRepoPicker(model: ConnectionPresentationModel) {
  const {
    setShowWorkspaceCreateRepoPicker,
    setWorkspaceCreateDraft,
    showWorkspaceCreateRepoPicker,
    taskUiReady,
    workspaceCreateDraft,
    workspaceCreateTargetRepo,
    workspaceRepoOptions
  } = model
  return (
    <PickerModal
      visible={taskUiReady && workspaceCreateDraft != null && showWorkspaceCreateRepoPicker}
      title={translate('m.tasks.4414bc388e', 'Repository')}
      options={workspaceRepoOptions}
      selected={workspaceCreateTargetRepo?.id ?? ''}
      onSelect={(repoId) => {
        setWorkspaceCreateDraft((current) =>
          current ? { ...current, repoIdOverride: repoId } : current
        )
        setShowWorkspaceCreateRepoPicker(false)
      }}
      onClose={() => setShowWorkspaceCreateRepoPicker(false)}
      zIndex={TASK_SECONDARY_DRAWER_Z_INDEX + 1}
    />
  )
}

export function renderMobileTasksWorkspaceAgentPicker(model: ConnectionPresentationModel) {
  const {
    resolvedWorkspaceAgent,
    setShowWorkspaceAgentPicker,
    setWorkspaceAgent,
    setWorkspaceAgentOverridden,
    showWorkspaceAgentPicker,
    taskUiReady,
    workspaceAgentOptions,
    workspaceCreateDraft
  } = model
  return (
    <PickerModal
      visible={taskUiReady && workspaceCreateDraft != null && showWorkspaceAgentPicker}
      title={translate('m.tasks.c03eedc8a5', 'Agent')}
      options={workspaceAgentOptions}
      selected={resolvedWorkspaceAgent}
      onSelect={(agent) => {
        setWorkspaceAgentOverridden(true)
        setWorkspaceAgent(agent)
        setShowWorkspaceAgentPicker(false)
      }}
      onClose={() => setShowWorkspaceAgentPicker(false)}
      zIndex={TASK_SECONDARY_DRAWER_Z_INDEX + 1}
    />
  )
}
