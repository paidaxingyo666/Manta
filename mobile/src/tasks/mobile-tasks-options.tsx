import {
  type PickerOption,
  type TaskProvider,
  TaskProviderLogo,
  colors,
  getLinkedWorkItemSuggestedName,
  type GitHubProjectSettings
} from './mobile-tasks-dependencies'
import type { GitHubProjectSortDirection } from '../../../src/shared/github/project-types'
import type { ProjectGroup } from '../../../src/shared/github/project-group-sort'
import type {
  GitHubMode,
  GitHubPreset,
  GitHubProjectRow,
  GitLabFilter,
  GitLabView,
  LinearDisplayProperty,
  LinearFilter,
  LinearGroupBy,
  LinearOrderBy,
  LinearViewMode,
  TaskSort
} from './mobile-tasks-view-state-types'
import type { ActionableTaskItem } from './mobile-tasks-project-workspace-types'
import type { DetailComment, LinearIssue } from './mobile-tasks-provider-detail-types'
import { translate } from '../i18n/i18n'
import { localizedConstant } from '../i18n/localized-constant'

export const PROVIDER_OPTIONS = localizedConstant((): PickerOption<TaskProvider>[] => [
  {
    value: 'github',
    label: translate('m.tasks.81c733b110', 'GitHub'),
    subtitle: translate('m.tasks.9a89d8a794', 'Issues and pull requests'),
    renderIcon: (selected) => (
      <TaskProviderLogo
        provider="github"
        size={16}
        color={selected ? colors.textPrimary : colors.textSecondary}
      />
    )
  },
  {
    value: 'gitlab',
    label: translate('m.tasks.05a5ce3bd3', 'GitLab'),
    subtitle: translate('m.tasks.7013e8ca3f', 'Issues and merge requests'),
    renderIcon: (selected) => (
      <TaskProviderLogo
        provider="gitlab"
        size={16}
        color={selected ? colors.textPrimary : colors.textSecondary}
      />
    )
  },
  {
    value: 'linear',
    label: translate('m.tasks.47fef27ba3', 'Linear'),
    subtitle: translate('m.tasks.2fd235a0b0', 'Assigned and team issues'),
    renderIcon: (selected) => (
      <TaskProviderLogo
        provider="linear"
        size={16}
        color={selected ? colors.textPrimary : colors.textSecondary}
      />
    )
  }
])

export const GITLAB_FILTER_OPTIONS = localizedConstant((): PickerOption<GitLabFilter>[] => [
  {
    value: 'opened',
    label: translate('m.tasks.733c49ee24', 'Open'),
    subtitle: translate('m.tasks.0e6dc1103b', 'Open issues and merge requests')
  },
  {
    value: 'merged',
    label: translate('m.tasks.1adaee9dc5', 'Merged'),
    subtitle: translate('m.tasks.7cce2f6a06', 'Merged merge requests')
  },
  {
    value: 'closed',
    label: translate('m.tasks.069be2492c', 'Closed'),
    subtitle: translate('m.tasks.9b963af4f7', 'Closed issues and merge requests')
  },
  {
    value: 'all',
    label: translate('m.tasks.80817ce75f', 'All'),
    subtitle: translate('m.tasks.4afbbaed03', 'Any GitLab state')
  }
])

export const LINEAR_FILTER_OPTIONS = localizedConstant((): PickerOption<LinearFilter>[] => [
  {
    value: 'all',
    label: translate('m.tasks.80817ce75f', 'All'),
    subtitle: translate('m.tasks.fe44fbb901', 'Open issues across connected workspaces')
  },
  {
    value: 'assigned',
    label: translate('m.tasks.a4ffb4ee71', 'My Issues'),
    subtitle: translate('m.tasks.78db01c922', 'Issues assigned to you')
  },
  {
    value: 'created',
    label: translate('m.tasks.a3f8fe1681', 'Created'),
    subtitle: translate('m.tasks.9110e576a8', 'Issues created by you')
  },
  {
    value: 'completed',
    label: translate('m.tasks.1dabaa2f96', 'Completed'),
    subtitle: translate('m.tasks.096f1e9798', 'Recently completed issues')
  }
])

export const LINEAR_VIEW_OPTIONS = localizedConstant((): PickerOption<LinearViewMode>[] => [
  {
    value: 'list',
    label: translate('m.tasks.b48817d5a9', 'List'),
    subtitle: translate('m.tasks.e8601451af', 'Compact issue rows')
  },
  {
    value: 'board',
    label: translate('m.tasks.ba80138de0', 'Board'),
    subtitle: translate('m.tasks.24ac7a19dd', 'Grouped columns')
  }
])

export function taskWorkspaceFallback(item: ActionableTaskItem): string {
  if (item.provider === 'github' || item.provider === 'gitlab') {
    return `${item.source.type}-${item.source.number}`
  }
  return item.source.identifier.toLowerCase()
}

export function taskWorkspaceSuggestedName(item: ActionableTaskItem): string {
  return getLinkedWorkItemSuggestedName(item) || taskWorkspaceFallback(item)
}

export const COMMENT_REACTION_EMOJI: Record<
  NonNullable<DetailComment['reactions']>[number]['content'],
  string
> = {
  thumbs_up: '+1',
  thumbs_down: '-1',
  laugh: 'laugh',
  confused: 'confused',
  heart: 'heart',
  hooray: 'hooray',
  rocket: 'rocket',
  eyes: 'eyes'
}

export const LINEAR_GROUP_OPTIONS = localizedConstant((): PickerOption<LinearGroupBy>[] => [
  { value: 'none', label: translate('m.tasks.0ddf93cd70', 'No grouping') },
  { value: 'status', label: translate('m.tasks.15ae8aef22', 'Status') },
  { value: 'assignee', label: translate('m.tasks.6f7452906d', 'Assignee') },
  { value: 'priority', label: translate('m.tasks.212212945a', 'Priority') },
  { value: 'team', label: translate('m.tasks.73305d5fbc', 'Team') }
])

export const LINEAR_ORDER_OPTIONS = localizedConstant((): PickerOption<LinearOrderBy>[] => [
  { value: 'priority', label: translate('m.tasks.212212945a', 'Priority') },
  { value: 'updated', label: translate('m.tasks.e37bad9e9e', 'Updated') },
  { value: 'identifier', label: translate('m.tasks.929c42a79b', 'Identifier') }
])

export const LINEAR_DISPLAY_OPTIONS = localizedConstant(
  (): PickerOption<LinearDisplayProperty>[] => [
    { value: 'state', label: translate('m.tasks.15ae8aef22', 'Status') },
    { value: 'priority', label: translate('m.tasks.212212945a', 'Priority') },
    { value: 'assignee', label: translate('m.tasks.6f7452906d', 'Assignee') },
    { value: 'team', label: translate('m.tasks.73305d5fbc', 'Team') },
    { value: 'labels', label: translate('m.tasks.1a11cb6c10', 'Labels') },
    { value: 'updated', label: translate('m.tasks.e37bad9e9e', 'Updated') }
  ]
)

export const DEFAULT_LINEAR_DISPLAY_PROPERTIES: LinearDisplayProperty[] = [
  'state',
  'priority',
  'assignee',
  'team',
  'labels',
  'updated'
]

export const GITHUB_KIND_OPTIONS = localizedConstant((): PickerOption<GitHubMode>[] => [
  {
    value: 'issues',
    label: translate('m.tasks.e3577861c3', 'Issues'),
    subtitle: translate('m.tasks.3c02bc9b07', 'GitHub issues')
  },
  {
    value: 'prs',
    label: translate('m.tasks.5e3fb77dd8', 'PRs'),
    subtitle: translate('m.tasks.454d34f456', 'GitHub pull requests')
  },
  {
    value: 'project',
    label: translate('m.tasks.2c1f90ca13', 'Projects'),
    subtitle: translate('m.tasks.40d8fbad4a', 'GitHub Projects views')
  }
])

export const ISSUE_PRESETS = localizedConstant((): PickerOption<GitHubPreset>[] => [
  {
    value: 'issues',
    label: translate('m.tasks.733c49ee24', 'Open'),
    subtitle: translate('m.tasks.e0767b497c', 'Open GitHub issues')
  },
  {
    value: 'my-issues',
    label: translate('m.tasks.35e7949626', 'Assigned to me'),
    subtitle: translate('m.tasks.f74971febc', 'Open issues assigned to you')
  }
])

export const PR_PRESETS = localizedConstant((): PickerOption<GitHubPreset>[] => [
  {
    value: 'prs',
    label: translate('m.tasks.733c49ee24', 'Open'),
    subtitle: translate('m.tasks.e2af88aadb', 'Open pull requests')
  },
  {
    value: 'my-prs',
    label: translate('m.tasks.0e2b5a540e', 'Mine'),
    subtitle: translate('m.tasks.41c6f687f9', 'Pull requests authored by you')
  },
  {
    value: 'review',
    label: translate('m.tasks.a31d90dd7e', 'Needs review'),
    subtitle: translate('m.tasks.55e8f0f221', 'Review requests assigned to you')
  }
])

export const GITLAB_VIEW_OPTIONS = localizedConstant((): PickerOption<GitLabView>[] => [
  {
    value: 'project',
    label: translate('m.tasks.7f18577bdf', 'Project MRs'),
    subtitle: translate('m.tasks.08dad860f5', 'Merge requests and issues by repository')
  },
  {
    value: 'todos',
    label: translate('m.tasks.b8b23d4005', 'My Todos'),
    subtitle: translate('m.tasks.9dc97b7c46', 'Pending GitLab todos')
  }
])

export const SORT_OPTIONS = localizedConstant((): PickerOption<TaskSort>[] => [
  {
    value: 'updated',
    label: translate('m.tasks.e37bad9e9e', 'Updated'),
    subtitle: translate('m.tasks.e396dc7b91', 'Newest activity first')
  },
  {
    value: 'repository',
    label: translate('m.tasks.4414bc388e', 'Repository'),
    subtitle: translate('m.tasks.ffde92a257', 'Group by repository, then newest activity')
  }
])

export type ProjectSortOverride = { fieldId: string; direction: GitHubProjectSortDirection }

export type ProjectListEntry =
  | { type: 'group'; group: ProjectGroup; collapsed: boolean }
  | { type: 'row'; row: GitHubProjectRow }

export type LinearIssueSection = {
  key: string
  label: string
  color: string
  issues: LinearIssue[]
}

export type LinearListEntry =
  | { type: 'section'; section: LinearIssueSection }
  | { type: 'issue'; issue: LinearIssue }

export const PROJECT_VIEW_DEFAULT_SORT = '__view_default__'

export const GITHUB_REPO_CONCURRENCY = 3

export const MAX_RENDERED_PR_DIFF_LINES = 400

export const GITLAB_PER_PAGE = 50

export const LINEAR_LIMIT = 50

// Why: task detail drawers can launch child sheets; children must layer above
// the still-mounted parent while its dismissal animation/state remains alive.
export const TASK_SECONDARY_DRAWER_Z_INDEX = 1100

// Why: the mobile detail drawer should support quick triage and core actions.
// Desktop keeps the broad metadata editing surface for dense issue/PR work.
export const SHOW_MOBILE_DETAIL_LABEL_CHIPS = false

export const SHOW_MOBILE_DETAIL_METADATA_EDITORS = false

export const SHOW_MOBILE_DETAIL_REVIEW_PANELS = false

export const SHOW_MOBILE_LINEAR_DETAIL_TOOLS = false

export const SHOW_MOBILE_COMMENT_THREAD_TOOLS = false

export const SHOW_MOBILE_PROJECT_METADATA_EDITORS = false

export const SHOW_MOBILE_PROJECT_REVIEW_PANELS = false

export const EMPTY_GITHUB_PROJECT_SETTINGS: GitHubProjectSettings = {
  pinned: [],
  recent: [],
  lastViewByProject: {},
  activeProject: null
}
