import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import {
  BottomDrawer,
  View,
  Text,
  Pressable,
  Linking,
  ExternalLink,
  colors,
  Copy,
  TaskProviderLogo,
  ActivityIndicator,
  Plus,
  RefreshCw,
  X,
  GitBranch
} from './mobile-tasks-dependencies'
import { styles } from './mobile-tasks-legacy-styles'
import {
  projectRowStatusLabel,
  SHOW_MOBILE_DETAIL_LABEL_CHIPS,
  SHOW_MOBILE_PROJECT_METADATA_EDITORS,
  githubProjectOptionColor,
  canCreateWorkspaceFromProjectRow,
  projectRowType
} from './mobile-tasks-legacy-foundation'
import { renderMobileTasksProjectFieldEditors } from './mobile-tasks-project-field-editors'
import {
  renderMobileTasksProjectLabelsEditor,
  renderMobileTasksProjectAssigneesEditor
} from './mobile-tasks-project-metadata-editors'
import { renderMobileTasksProjectLoadedDetail } from './mobile-tasks-project-detail-content'
import { translate } from '../i18n/i18n'

export function renderMobileTasksProjectMissingRepoDrawer(model: ConnectionPresentationModel) {
  const {
    copiedLinkKey,
    copyTextToClipboard,
    projectRepoNotInManta,
    setProjectRepoNotInManta,
    taskUiReady
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && projectRepoNotInManta != null}
      onClose={() => {
        setProjectRepoNotInManta(null)
      }}
    >
      {projectRepoNotInManta ? (
        <View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {translate('m.tasks.ffc86dd787', 'Repository not in Manta')}
            </Text>
            <Text style={styles.sheetSubtitle}>
              {projectRepoNotInManta.owner}/{projectRepoNotInManta.repo}{' '}
              {translate(
                'm.tasks.79f69cf413',
                'is not added to Manta. Add this repository from the desktop app, then refresh mobile Tasks.'
              )}{' '}
            </Text>
          </View>

          <View style={styles.actionGroup}>
            {projectRepoNotInManta.url ? (
              <Pressable
                style={styles.actionRow}
                onPress={() => {
                  if (projectRepoNotInManta.url) {
                    void Linking.openURL(projectRepoNotInManta.url)
                  }
                }}
              >
                <ExternalLink size={16} color={colors.textPrimary} />
                <Text style={styles.actionText}>
                  {translate('m.tasks.8ca7f70cf2', 'Open in GitHub')}
                </Text>
              </Pressable>
            ) : null}
            {projectRepoNotInManta.url ? <View style={styles.actionSeparator} /> : null}
            <Pressable
              style={styles.actionRow}
              onPress={() =>
                void copyTextToClipboard(
                  `project-repo:${projectRepoNotInManta.owner}/${projectRepoNotInManta.repo}`,
                  `${projectRepoNotInManta.owner}/${projectRepoNotInManta.repo}`
                )
              }
            >
              <Copy size={16} color={colors.textPrimary} />
              <Text style={styles.actionText}>
                {copiedLinkKey ===
                `project-repo:${projectRepoNotInManta.owner}/${projectRepoNotInManta.repo}`
                  ? translate('m.tasks.c43f5c54e5', 'Copied')
                  : translate('m.tasks.7864fc2cd3', 'Copy repository')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </BottomDrawer>
  )
}

export function renderMobileTasksProjectDetailDrawer(model: ConnectionPresentationModel) {
  const {
    activeProjectLabel,
    copiedLinkKey,
    copyTaskLink,
    createWorkspaceFromProjectRow,
    creatingKey,
    mutateProjectRowIssueType,
    projectIssueTypes,
    projectIssueTypesError,
    projectIssueTypesLoading,
    projectMutating,
    projectRowDetail,
    projectRowHostedRepo,
    projectRowItem,
    setMergeMethodProjectRow,
    setPendingHostedStateChange,
    setProjectRowItem,
    taskUiReady
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && projectRowItem != null}
      onClose={() => setProjectRowItem(null)}
    >
      {projectRowItem ? (
        <View>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <TaskProviderLogo provider="github" size={16} color={colors.textPrimary} />
              <Text style={styles.sheetTitle} numberOfLines={2}>
                {projectRowItem.content.title}
              </Text>
            </View>
            <Text style={styles.sheetSubtitle}>
              {translate('m.tasks.fdacd01fb3', 'GitHub Project ·')}{' '}
              {projectRowItem.content.repository ?? activeProjectLabel}
              {projectRowItem.content.number ? ` #${projectRowItem.content.number}` : ''}
            </Text>
          </View>

          <View style={styles.detailGroup}>
            <View style={styles.detailMetaGrid}>
              <View style={styles.detailMetaItem}>
                <Text style={styles.detailMetaLabel}>
                  {translate('m.tasks.a36f9052f5', 'Type')}
                </Text>
                <Text style={styles.detailMetaValue}>
                  {projectRowItem.itemType === 'PULL_REQUEST'
                    ? translate('m.tasks.05ac26f906', 'Pull request')
                    : projectRowItem.itemType === 'ISSUE'
                      ? translate('m.tasks.c5c83a9af1', 'Issue')
                      : projectRowItem.itemType === 'DRAFT_ISSUE'
                        ? translate('m.tasks.8c666876cf', 'Draft issue')
                        : translate('m.tasks.367621449b', 'Project item')}
                </Text>
              </View>
              <View style={styles.detailMetaItem}>
                <Text style={styles.detailMetaLabel}>
                  {translate('m.tasks.15ae8aef22', 'Status')}
                </Text>
                <Text style={styles.detailMetaValue}>{projectRowStatusLabel(projectRowItem)}</Text>
              </View>
            </View>
            {SHOW_MOBILE_DETAIL_LABEL_CHIPS &&
            (projectRowDetail?.provider === 'github'
              ? projectRowDetail.labels
              : projectRowItem.content.labels.map((label) => label.name)
            ).length > 0 ? (
              <View style={styles.chipRow}>
                {(projectRowDetail?.provider === 'github'
                  ? projectRowDetail.labels
                  : projectRowItem.content.labels.map((label) => label.name)
                )
                  .slice(0, 6)
                  .map((label) => (
                    <View key={label} style={styles.detailChip}>
                      <Text style={styles.detailChipText}>{label}</Text>
                    </View>
                  ))}
              </View>
            ) : null}
            {SHOW_MOBILE_PROJECT_METADATA_EDITORS && projectRowItem.itemType === 'ISSUE' ? (
              <View style={styles.detailSection}>
                <View style={styles.detailSectionHeader}>
                  <Text style={styles.detailSectionTitle}>
                    {translate('m.tasks.d58b83808f', 'Issue type')}
                  </Text>
                  <Text style={styles.detailSectionMeta}>
                    {projectRowItem.content.issueType?.name ??
                      translate('m.tasks.234befedac', 'No type')}
                  </Text>
                </View>
                {projectIssueTypesLoading ? (
                  <View style={styles.detailLoadingInline}>
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                    <Text style={styles.detailMuted}>
                      {translate('m.tasks.c36deb9937', 'Loading issue types...')}
                    </Text>
                  </View>
                ) : projectIssueTypesError ? (
                  <Text style={styles.detailError}>{projectIssueTypesError}</Text>
                ) : projectIssueTypes.length === 0 ? (
                  <Text style={styles.detailMuted}>
                    {translate(
                      'm.tasks.e43106b8ae',
                      'No issue types configured for this repository.'
                    )}{' '}
                  </Text>
                ) : (
                  <View style={styles.chipRow}>
                    {projectIssueTypes.map((issueType) => {
                      const selected = projectRowItem.content.issueType?.id === issueType.id
                      return (
                        <Pressable
                          key={issueType.id}
                          style={[
                            styles.detailChip,
                            selected ? styles.detailChipSelected : undefined
                          ]}
                          disabled={projectMutating || selected}
                          onPress={() => void mutateProjectRowIssueType(projectRowItem, issueType)}
                        >
                          <View style={styles.issueTypeChipContent}>
                            <View
                              style={[
                                styles.issueTypeDot,
                                { backgroundColor: githubProjectOptionColor(issueType.color) }
                              ]}
                            />
                            <Text style={styles.detailChipText}>{issueType.name}</Text>
                          </View>
                        </Pressable>
                      )
                    })}
                    {projectRowItem.content.issueType ? (
                      <Pressable
                        style={styles.detailChip}
                        disabled={projectMutating}
                        onPress={() => void mutateProjectRowIssueType(projectRowItem, null)}
                      >
                        <Text style={styles.detailChipText}>
                          {translate('m.tasks.de9e1030f7', 'Clear type')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            ) : null}
            {renderMobileTasksProjectFieldEditors(model)}
            {renderMobileTasksProjectLabelsEditor(model)}
            {renderMobileTasksProjectAssigneesEditor(model)}
            {renderMobileTasksProjectLoadedDetail(model)}
          </View>

          <View style={styles.actionGroup}>
            {canCreateWorkspaceFromProjectRow(projectRowItem) ? (
              <Pressable
                style={styles.actionRow}
                disabled={creatingKey === `github-project:${projectRowItem.id}`}
                onPress={() => void createWorkspaceFromProjectRow(projectRowItem)}
              >
                <Plus size={16} color={colors.textPrimary} />
                <Text style={styles.actionText}>
                  {translate('m.tasks.d783b7fb2b', 'Create Workspace')}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.emptyInlineText}>
                {translate(
                  'm.tasks.7e7816b5ce',
                  'Workspaces can only be created from GitHub issues and pull requests.'
                )}{' '}
              </Text>
            )}

            {projectRowItem.content.url ? (
              <>
                {canCreateWorkspaceFromProjectRow(projectRowItem) ? (
                  <View style={styles.actionSeparator} />
                ) : null}
                <Pressable
                  style={styles.actionRow}
                  onPress={() => {
                    if (projectRowItem.content.url) {
                      void Linking.openURL(projectRowItem.content.url)
                    }
                  }}
                >
                  <ExternalLink size={16} color={colors.textPrimary} />
                  <Text style={styles.actionText}>
                    {translate('m.tasks.8ca7f70cf2', 'Open in GitHub')}
                  </Text>
                </Pressable>
                <View style={styles.actionSeparator} />
                <Pressable
                  style={styles.actionRow}
                  onPress={() =>
                    projectRowItem.content.url
                      ? void copyTaskLink(
                          `github-project:${projectRowItem.id}`,
                          projectRowItem.content.url
                        )
                      : undefined
                  }
                >
                  <Copy size={16} color={colors.textPrimary} />
                  <Text style={styles.actionText}>
                    {copiedLinkKey === `github-project:${projectRowItem.id}`
                      ? translate('m.tasks.c43f5c54e5', 'Copied')
                      : translate('m.tasks.bd6efe9dde', 'Copy GitHub link')}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {projectRowType(projectRowItem) &&
            projectRowItem.content.state !== 'MERGED' &&
            projectRowItem.itemType !== 'DRAFT_ISSUE' ? (
              <>
                <View style={styles.actionSeparator} />
                <Pressable
                  style={styles.actionRow}
                  disabled={projectMutating}
                  onPress={() => {
                    const nextState = projectRowItem.content.state === 'CLOSED' ? 'open' : 'closed'
                    if (projectRowItem.itemType === 'PULL_REQUEST') {
                      setPendingHostedStateChange({
                        source: 'project',
                        row: projectRowItem,
                        nextState
                      })
                      return
                    }
                    setPendingHostedStateChange({
                      source: 'project',
                      row: projectRowItem,
                      nextState
                    })
                  }}
                >
                  {projectRowItem.content.state === 'CLOSED' ? (
                    <RefreshCw size={16} color={colors.textPrimary} />
                  ) : (
                    <X size={16} color={colors.textPrimary} />
                  )}
                  <Text style={styles.actionText}>
                    {projectRowItem.content.state === 'CLOSED'
                      ? translate('m.tasks.bde826cb6c', 'Reopen item')
                      : translate('m.tasks.f5b7df9238', 'Close item')}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {projectRowItem.itemType === 'PULL_REQUEST' &&
            projectRowItem.content.state !== 'CLOSED' &&
            projectRowItem.content.state !== 'MERGED' ? (
              <>
                <View style={styles.actionSeparator} />
                <Pressable
                  style={styles.actionRow}
                  disabled={projectMutating || !projectRowHostedRepo}
                  onPress={() => setMergeMethodProjectRow(projectRowItem)}
                >
                  <GitBranch size={16} color={colors.textPrimary} />
                  <Text style={styles.actionText}>
                    {translate('m.tasks.30f30656e9', 'Merge pull request')}
                  </Text>
                </Pressable>
                {!projectRowHostedRepo ? (
                  <Text style={styles.emptyInlineText}>
                    {translate(
                      'm.tasks.62e4e4fab6',
                      'Merge requires this repository in Manta.'
                    )}{' '}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </BottomDrawer>
  )
}
