import type { DetailCommentRenderersModel } from './use-mobile-tasks-detail-comment-renderers'
import { type PickerOption, View, useMemo } from './mobile-tasks-dependencies'
import {
  type GitHubRepoSources,
  type LinearTeam,
  PROJECT_VIEW_DEFAULT_SORT,
  PROVIDER_OPTIONS,
  type RepoSummary,
  SORT_OPTIONS,
  type TaskListEntry,
  compareTasksByRepository,
  compareTasksByUpdated,
  getRepoBadgeColor,
  hasGitHubIssueSourceChoice,
  issueSourceSlug,
  taskRepositoryMeta
} from './mobile-tasks-legacy-foundation'
import { styles } from './mobile-tasks-legacy-styles'
import { translate } from '../i18n/i18n'

export function useMobileTasksPickerProjection(model: DetailCommentRenderersModel) {
  const {
    createRepoId,
    createTeamId,
    githubMode,
    githubProjectAvailableSummaryFields,
    githubProjectSortOverride,
    githubProjectSummaryFields,
    githubProjectTable,
    githubProjectViews,
    githubRepoSources,
    hostedRepos,
    items,
    linearTeams,
    provider,
    reposById,
    selectedHostedRepos,
    selectedRepoIds,
    taskSort,
    visibleProviders,
    workspaceRepos
  } = model
  const createTargetOptions = useMemo<PickerOption<string>[]>(
    () =>
      provider === 'github' || provider === 'gitlab'
        ? hostedRepos.map((repo) => ({
            value: repo.id,
            label: repo.displayName,
            subtitle: repo.path,
            renderIcon: () => (
              <View
                style={[
                  styles.pickerRepoDot,
                  { backgroundColor: getRepoBadgeColor(repo, repo.displayName) }
                ]}
              />
            )
          }))
        : linearTeams.map((team) => ({
            value: team.id,
            label: team.name,
            subtitle: team.workspaceName
          })),
    [hostedRepos, linearTeams, provider]
  )
  const selectedCreateTarget =
    provider === 'github' || provider === 'gitlab'
      ? (hostedRepos.find((repo) => repo.id === createRepoId) ?? hostedRepos[0] ?? null)
      : (linearTeams.find((team) => team.id === createTeamId) ?? linearTeams[0] ?? null)
  const selectedCreateTargetLabel =
    provider === 'github' || provider === 'gitlab'
      ? ((selectedCreateTarget as RepoSummary | null)?.displayName ??
        translate('m.tasks.c7c8a82c20', 'Select target'))
      : ((selectedCreateTarget as LinearTeam | null)?.name ??
        translate('m.tasks.c7c8a82c20', 'Select target'))
  const providerLabel =
    provider === 'github'
      ? translate('m.tasks.81c733b110', 'GitHub')
      : provider === 'gitlab'
        ? translate('m.tasks.05a5ce3bd3', 'GitLab')
        : translate('m.tasks.47fef27ba3', 'Linear')
  const showHeaderCreateTask =
    provider === 'linear' || (provider === 'github' && githubMode === 'items')
  const providerOptions = useMemo(
    () => PROVIDER_OPTIONS().filter((option) => visibleProviders.includes(option.value)),
    [visibleProviders]
  )
  const selectedCreateRepo =
    provider === 'github' || provider === 'gitlab'
      ? (selectedCreateTarget as RepoSummary | null)
      : null
  const selectedCreateGitHubSources =
    provider === 'github' && selectedCreateRepo
      ? githubRepoSources[selectedCreateRepo.id]
      : undefined
  const selectedCreateIssuePreference =
    selectedCreateRepo?.issueSourcePreference === 'origin' ||
    selectedCreateRepo?.issueSourcePreference === 'upstream'
      ? selectedCreateRepo.issueSourcePreference
      : 'upstream'
  const githubIssueSourceRows = useMemo(
    () =>
      selectedHostedRepos
        .map((repo) => ({ repo, sources: githubRepoSources[repo.id] }))
        .filter((entry): entry is { repo: RepoSummary; sources: GitHubRepoSources } =>
          hasGitHubIssueSourceChoice(entry.sources)
        ),
    [githubRepoSources, selectedHostedRepos]
  )
  const githubIssueSourceLabel =
    githubIssueSourceRows.length === 1
      ? issueSourceSlug(
          githubIssueSourceRows[0]!.repo.issueSourcePreference === 'origin'
            ? githubIssueSourceRows[0]!.sources.prs
            : githubIssueSourceRows[0]!.sources.upstreamCandidate
        )
      : translate('m.tasks.c97d88e507', '{{value0}} sources', {
          value0: githubIssueSourceRows.length
        })
  const repoPickerLabel =
    selectedRepoIds.size === 0 || selectedHostedRepos.length === hostedRepos.length
      ? translate('m.tasks.741999e374', 'All repos')
      : selectedHostedRepos.length === 1
        ? selectedHostedRepos[0]!.displayName
        : translate('m.tasks.ceb85019a0', '{{value0}} repos', {
            value0: selectedHostedRepos.length
          })
  const repoPickerSelectedRepo =
    selectedRepoIds.size > 0 && selectedHostedRepos.length === 1 ? selectedHostedRepos[0]! : null
  const workspaceRepoOptions = useMemo<PickerOption<string>[]>(
    () =>
      workspaceRepos.map((repo) => ({
        value: repo.id,
        label: repo.displayName,
        subtitle: repo.path,
        renderIcon: () => (
          <View
            style={[
              styles.pickerRepoDot,
              { backgroundColor: getRepoBadgeColor(repo, repo.displayName) }
            ]}
          />
        )
      })),
    [workspaceRepos]
  )
  const sortedItems = useMemo(() => {
    const next = [...items]
    if (taskSort === 'repository') {
      next.sort((a, b) => compareTasksByRepository(a, b, reposById))
    } else {
      next.sort(compareTasksByUpdated)
    }
    return next
  }, [items, reposById, taskSort])
  const displayedEntries = useMemo<TaskListEntry[]>(() => {
    if (taskSort !== 'repository') {
      return sortedItems.map((item) => ({ type: 'item', key: item.key, item }))
    }
    const entries: TaskListEntry[] = []
    let previousRepoKey = ''
    for (const item of sortedItems) {
      const repo = taskRepositoryMeta(item, reposById)
      if (repo.key !== previousRepoKey) {
        entries.push({
          type: 'section',
          key: `section:${repo.key}`,
          label: repo.label,
          color: repo.color
        })
        previousRepoKey = repo.key
      }
      entries.push({ type: 'item', key: item.key, item })
    }
    return entries
  }, [reposById, sortedItems, taskSort])
  const sortLabel =
    SORT_OPTIONS().find((option) => option.value === taskSort)?.label ??
    translate('m.tasks.e37bad9e9e', 'Updated')
  const githubProjectFields = githubProjectTable?.selectedView.fields ?? []
  const githubProjectViewSort = githubProjectTable?.selectedView.sortByFields?.[0] ?? null
  const githubProjectSortField = githubProjectSortOverride
    ? githubProjectFields.find((field) => field.id === githubProjectSortOverride.fieldId)
    : githubProjectViewSort?.field
  const githubProjectSortDirection =
    githubProjectSortOverride?.direction ?? githubProjectViewSort?.direction ?? null
  const githubProjectSortLabel = githubProjectSortField
    ? `${githubProjectSortField.name} ${githubProjectSortDirection === 'DESC' ? translate('m.tasks.d881447de0', 'desc') : translate('m.tasks.ab3102f723', 'asc')}`
    : translate('m.tasks.1ecfa2eb62', 'View order')
  const githubProjectFieldsLabel =
    githubProjectAvailableSummaryFields.length > 0
      ? translate('m.tasks.04952594ab.a38e31', '{{value0}}/{{value1}} fields', {
          value0: githubProjectSummaryFields.length,
          value1: githubProjectAvailableSummaryFields.length
        })
      : translate('m.tasks.0e2b97419a', 'Fields')
  const githubProjectSortOptions = useMemo<PickerOption<string>[]>(
    () => [
      {
        value: PROJECT_VIEW_DEFAULT_SORT,
        label: translate('m.tasks.1ecfa2eb62', 'View order'),
        subtitle: githubProjectViewSort
          ? translate('m.tasks.a0e54c9934', 'Uses {{value0}} {{value1}}', {
              value0: githubProjectViewSort.field.name,
              value1: githubProjectViewSort.direction.toLowerCase()
            })
          : translate('m.tasks.3fe6566a6c', 'Uses GitHub rank order')
      },
      ...githubProjectFields.map((field) => {
        const active = githubProjectSortOverride?.fieldId === field.id
        const nextDirection =
          !active || githubProjectSortOverride.direction === 'DESC' ? 'ascending' : 'descending'
        return {
          value: field.id,
          label: field.name,
          subtitle: active
            ? translate('m.tasks.70dfd9fbef', 'Currently {{value0}} · tap for {{value1}}', {
                value0: githubProjectSortOverride.direction.toLowerCase(),
                value1: nextDirection
              })
            : translate('m.tasks.caf6cd559a', 'Sort ascending')
        }
      })
    ],
    [githubProjectFields, githubProjectSortOverride, githubProjectViewSort]
  )
  const githubProjectViewOptions = useMemo<PickerOption<string>[]>(
    () =>
      githubProjectViews.map((view) => ({
        value: view.id,
        label: view.name,
        subtitle:
          view.layout === 'TABLE_LAYOUT'
            ? translate('m.tasks.eac3fd864c', 'View #{{value0}}', { value0: view.number })
            : translate('m.tasks.74c50ae0bf', 'Unsupported layout on mobile'),
        disabled: view.layout !== 'TABLE_LAYOUT'
      })),
    [githubProjectViews]
  )
  return Object.assign(model, {
    createTargetOptions,
    selectedCreateTarget,
    selectedCreateTargetLabel,
    providerLabel,
    showHeaderCreateTask,
    providerOptions,
    selectedCreateRepo,
    selectedCreateGitHubSources,
    selectedCreateIssuePreference,
    githubIssueSourceRows,
    githubIssueSourceLabel,
    repoPickerLabel,
    repoPickerSelectedRepo,
    workspaceRepoOptions,
    sortedItems,
    displayedEntries,
    sortLabel,
    githubProjectFields,
    githubProjectViewSort,
    githubProjectSortField,
    githubProjectSortDirection,
    githubProjectSortLabel,
    githubProjectFieldsLabel,
    githubProjectSortOptions,
    githubProjectViewOptions
  })
}

export type PickerProjectionModel = ReturnType<typeof useMobileTasksPickerProjection>
