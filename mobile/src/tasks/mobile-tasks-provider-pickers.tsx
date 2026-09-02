import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import {
  PickerModal,
  BottomDrawer,
  View,
  Text,
  Pressable,
  Check,
  colors,
  ScrollView
} from './mobile-tasks-dependencies'
import {
  normalizeGitHubPreset,
  getTaskPresetQuery,
  githubKindFromQuery,
  scopeGitHubTaskSearch,
  normalizeLinearFilter,
  repositoryCount,
  getRepoBadgeColor,
  issueSourceSlug,
  GITHUB_KIND_OPTIONS
} from './mobile-tasks-legacy-foundation'
import { styles } from './mobile-tasks-legacy-styles'
import { translate } from '../i18n/i18n'

export function renderMobileTasksProviderPicker(model: ConnectionPresentationModel) {
  const {
    githubPreset,
    persistTaskSource,
    provider,
    providerOptions,
    setAppliedQuery,
    setGithubKind,
    setGithubMode,
    setGithubPreset,
    setItems,
    setLinearFilter,
    setProvider,
    setQuery,
    setShowProviderPicker,
    showProviderPicker,
    taskResumeRef,
    taskUiReady
  } = model
  return (
    <PickerModal
      visible={taskUiReady && showProviderPicker}
      title={translate('m.tasks.2409df9415', 'Task Source')}
      options={providerOptions}
      selected={provider}
      onSelect={(next) => {
        const resume = taskResumeRef.current
        persistTaskSource(next)
        setProvider(next)
        setItems([])
        if (next === 'github') {
          const nextMode = resume.githubMode === 'project' ? 'project' : 'items'
          setGithubMode(nextMode)
          if (nextMode === 'project') {
            setQuery('')
            setAppliedQuery('')
            return
          }
          const preset =
            resume.githubItemsPreset === null
              ? githubPreset
              : normalizeGitHubPreset(resume.githubItemsPreset ?? githubPreset)
          const nextQuery =
            resume.githubItemsPreset === null
              ? (resume.githubItemsQuery ?? '')
              : getTaskPresetQuery(preset)
          const nextKind = githubKindFromQuery(nextQuery, preset)
          setGithubPreset(preset)
          setGithubKind(nextKind)
          setQuery(nextQuery)
          setAppliedQuery(scopeGitHubTaskSearch(nextQuery, nextKind))
        } else if (next === 'linear') {
          const nextQuery = resume.linearQuery ?? ''
          setLinearFilter(normalizeLinearFilter(resume.linearPreset))
          setQuery(nextQuery)
          setAppliedQuery(nextQuery.trim())
        } else {
          setQuery('')
          setAppliedQuery('')
        }
      }}
      onClose={() => setShowProviderPicker(false)}
    />
  )
}

export function renderMobileTasksRepoPicker(model: ConnectionPresentationModel) {
  const {
    hostedRepos,
    persistRepoSelection,
    selectedRepoIds,
    setSelectedRepoIds,
    setShowRepoPicker,
    showRepoPicker,
    taskUiReady,
    toggleRepoSelection
  } = model
  return (
    <BottomDrawer visible={taskUiReady && showRepoPicker} onClose={() => setShowRepoPicker(false)}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{translate('m.tasks.a4c5842b9c', 'Repositories')}</Text>
        <Text style={styles.sheetSubtitle}>
          {translate('m.tasks.79cf65e9fa', 'Choose which repositories to query.')}
        </Text>
      </View>

      <View style={styles.repoPickerGroup}>
        <Pressable
          style={styles.repoPickerRow}
          onPress={() => {
            const allSelection = new Set<string>()
            setSelectedRepoIds(allSelection)
            persistRepoSelection(allSelection, hostedRepos)
          }}
        >
          <View style={styles.repoPickerTextWrap}>
            <Text style={styles.repoPickerTitle}>
              {translate('m.tasks.1688454ca7', 'All repositories')}
            </Text>
            <Text style={styles.repoPickerSubtitle}>{repositoryCount(hostedRepos.length)}</Text>
          </View>
          {selectedRepoIds.size === 0 ? <Check size={15} color={colors.textPrimary} /> : null}
        </Pressable>

        {hostedRepos.map((repo) => {
          const selected = selectedRepoIds.has(repo.id)
          return (
            <View key={repo.id}>
              <View style={styles.actionSeparator} />
              <Pressable style={styles.repoPickerRow} onPress={() => toggleRepoSelection(repo.id)}>
                <View
                  style={[
                    styles.pickerRepoDot,
                    { backgroundColor: getRepoBadgeColor(repo, repo.displayName) }
                  ]}
                />
                <View style={styles.repoPickerTextWrap}>
                  <Text style={styles.repoPickerTitle} numberOfLines={1}>
                    {repo.displayName}
                  </Text>
                  <Text style={styles.repoPickerSubtitle} numberOfLines={1}>
                    {repo.path}
                  </Text>
                </View>
                {selected ? <Check size={15} color={colors.textPrimary} /> : null}
              </Pressable>
            </View>
          )
        })}
      </View>
    </BottomDrawer>
  )
}

export function renderMobileTasksGitHubIssueSourcePicker(model: ConnectionPresentationModel) {
  const {
    githubIssueSourceRows,
    setGitHubIssueSourcePreference,
    setShowGitHubIssueSourcePicker,
    showGitHubIssueSourcePicker,
    taskUiReady
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && showGitHubIssueSourcePicker}
      onClose={() => setShowGitHubIssueSourcePicker(false)}
    >
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>
          {translate('m.tasks.6aaadd7285', 'GitHub Issue Sources')}
        </Text>
        <Text style={styles.sheetSubtitle}>
          {translate(
            'm.tasks.2c65b26ef1',
            'Choose whether each repository queries and creates work from upstream or origin.'
          )}{' '}
        </Text>
      </View>

      <View style={styles.repoPickerGroup}>
        {githubIssueSourceRows.length === 0 ? (
          <View style={styles.drawerLoadingRow}>
            <Text style={styles.detailMuted}>
              {translate('m.tasks.6b995d38c5', 'No alternate issue sources available.')}
            </Text>
          </View>
        ) : (
          githubIssueSourceRows.map(({ repo, sources }, index) => {
            const selectedPreference =
              repo.issueSourcePreference === 'origin' || repo.issueSourcePreference === 'upstream'
                ? repo.issueSourcePreference
                : 'upstream'
            return (
              <View key={repo.id}>
                {index > 0 ? <View style={styles.actionSeparator} /> : null}
                <View style={styles.issueSourceBox}>
                  <View style={styles.repoPickerTextWrap}>
                    <Text style={styles.repoPickerTitle} numberOfLines={1}>
                      {repo.displayName}
                    </Text>
                    <Text style={styles.issueSourceHint} numberOfLines={2}>
                      {translate('m.tasks.0be8e1a894', 'Querying')}{' '}
                      {issueSourceSlug(
                        selectedPreference === 'origin' ? sources.prs : sources.upstreamCandidate
                      )}
                    </Text>
                  </View>
                  <View style={styles.issueSourceSegment}>
                    {(['upstream', 'origin'] as const).map((preference) => {
                      const selected = selectedPreference === preference
                      const slug =
                        preference === 'upstream'
                          ? issueSourceSlug(sources.upstreamCandidate)
                          : issueSourceSlug(sources.prs)
                      return (
                        <Pressable
                          key={preference}
                          style={[
                            styles.issueSourceSegmentButton,
                            selected && styles.issueSourceSegmentButtonActive
                          ]}
                          accessibilityState={{ selected }}
                          onPress={() => void setGitHubIssueSourcePreference(repo, preference)}
                        >
                          <Text
                            style={[
                              styles.issueSourceSegmentText,
                              selected && styles.issueSourceSegmentTextActive
                            ]}
                          >
                            {preference === 'upstream'
                              ? translate('m.tasks.085f4e942e', 'Upstream')
                              : translate('m.tasks.19b172b893', 'Origin')}
                          </Text>
                          <Text style={styles.issueSourceSlug} numberOfLines={1}>
                            {slug}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
              </View>
            )
          })
        )}
      </View>
    </BottomDrawer>
  )
}

export function renderMobileTasksGitHubViewPicker(model: ConnectionPresentationModel) {
  const {
    githubKind,
    githubMode,
    persistTaskResumeState,
    setAppliedQuery,
    setGithubKind,
    setGithubMode,
    setGithubPreset,
    setItems,
    setQuery,
    setShowGitHubKindPicker,
    showGitHubKindPicker,
    taskUiReady
  } = model
  return (
    <PickerModal
      visible={taskUiReady && showGitHubKindPicker}
      title={translate('m.tasks.2e410a19af', 'GitHub View')}
      options={GITHUB_KIND_OPTIONS()}
      selected={githubMode === 'project' ? 'project' : githubKind}
      onSelect={(kind) => {
        if (kind === 'project') {
          setGithubMode('project')
          setItems([])
          persistTaskResumeState({ githubMode: 'project' })
          return
        }
        const preset = kind === 'prs' ? 'prs' : 'issues'
        const nextQuery = getTaskPresetQuery(preset)
        setGithubMode('items')
        setGithubKind(kind)
        setGithubPreset(preset)
        setQuery(nextQuery)
        setAppliedQuery(nextQuery)
        persistTaskResumeState({
          githubMode: 'items',
          githubItemsPreset: preset,
          githubItemsQuery: nextQuery
        })
      }}
      onClose={() => setShowGitHubKindPicker(false)}
    />
  )
}

export function renderMobileTasksGitHubPresetPicker(model: ConnectionPresentationModel) {
  const {
    githubKind,
    githubPreset,
    githubPresetPickerOptions,
    persistDefaultGitHubPreset,
    persistTaskResumeState,
    setAppliedQuery,
    setGithubKind,
    setGithubMode,
    setGithubPreset,
    setQuery,
    setShowGitHubPresetPicker,
    showGitHubPresetPicker,
    taskUiReady
  } = model
  return (
    <PickerModal
      visible={taskUiReady && showGitHubPresetPicker}
      title={
        githubKind === 'prs'
          ? translate('m.tasks.b10fa24be3', 'Pull Requests')
          : translate('m.tasks.e3577861c3', 'Issues')
      }
      options={githubPresetPickerOptions}
      selected={githubPreset}
      onSelect={(preset) => {
        const nextQuery = getTaskPresetQuery(preset)
        setGithubMode('items')
        setGithubKind(preset === 'issues' || preset === 'my-issues' ? 'issues' : 'prs')
        setGithubPreset(preset)
        setQuery(nextQuery)
        setAppliedQuery(nextQuery)
        persistTaskResumeState({
          githubItemsPreset: preset,
          githubItemsQuery: nextQuery
        })
      }}
      onLongSelect={persistDefaultGitHubPreset}
      onClose={() => setShowGitHubPresetPicker(false)}
    />
  )
}

export function renderMobileTasksPagePicker(model: ConnectionPresentationModel) {
  const {
    githubCurrentPage,
    githubPagePickerPages,
    githubPages,
    githubPaginationLoading,
    handleGitHubPageChange,
    setShowGitHubPagePicker,
    showGitHubPagePicker,
    taskUiReady
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && showGitHubPagePicker}
      onClose={() => setShowGitHubPagePicker(false)}
    >
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{translate('m.tasks.669b20d479', 'GitHub Pages')}</Text>
        <Text style={styles.sheetSubtitle}>
          {translate('m.tasks.2bcd15ef19', 'Jump to a loaded or available result page.')}
        </Text>
      </View>
      <ScrollView style={styles.pagePickerList}>
        {githubPagePickerPages.map((index) => {
          const selected = index === githubCurrentPage
          const loaded = index < githubPages.length
          return (
            <Pressable
              key={`github-page:${index}`}
              style={[styles.pickerRow, selected && styles.pickerRowSelected]}
              disabled={githubPaginationLoading}
              onPress={() => {
                setShowGitHubPagePicker(false)
                void handleGitHubPageChange(index)
              }}
            >
              <View style={styles.pickerRowContent}>
                <Text style={styles.pickerRowLabel}>
                  {translate('m.tasks.eda57a4655.fb0627', 'Page')}
                  {index + 1}
                </Text>
                <Text style={styles.pickerRowSubtitle}>
                  {loaded
                    ? translate('m.tasks.711ea5b96d', 'Loaded')
                    : translate('m.tasks.e64ab47a47', 'Loads older results')}
                </Text>
              </View>
              {selected ? <Check size={16} color={colors.textPrimary} /> : null}
            </Pressable>
          )
        })}
      </ScrollView>
    </BottomDrawer>
  )
}
