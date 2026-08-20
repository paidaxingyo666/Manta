import type { WorkspaceStatusDefinition } from '../../../src/shared/worktree/types'
import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'

export const DEFAULT_MOBILE_WORKSPACE_STATUS_ID = 'in-progress'

export const defaultMobileWorkspaceStatuses = localizedConstant(
  () =>
    [
      {
        id: 'completed',
        label: translate('m.mobile.workspace.statuses.1257848b64', 'Done'),
        color: 'conductor-done',
        icon: 'conductor-done'
      },
      {
        id: 'in-review',
        label: translate('m.mobile.workspace.statuses.9a0f28ceab', 'In review'),
        color: 'conductor-review',
        icon: 'conductor-review'
      },
      {
        id: DEFAULT_MOBILE_WORKSPACE_STATUS_ID,
        label: translate('m.mobile.workspace.statuses.85679374e3', 'In progress'),
        color: 'conductor-progress',
        icon: 'conductor-progress'
      },
      {
        id: 'todo',
        label: translate('m.mobile.workspace.statuses.cd6c22dfea', 'Todo'),
        color: 'neutral',
        icon: 'circle'
      }
    ] as const satisfies readonly WorkspaceStatusDefinition[]
)

export function coerceMobileWorkspaceStatuses(
  statuses: readonly WorkspaceStatusDefinition[]
): readonly WorkspaceStatusDefinition[] {
  return statuses.length > 0 ? statuses : defaultMobileWorkspaceStatuses()
}

export function getMobileWorkspaceStatus(
  worktree: { workspaceStatus?: string | null },
  statuses: readonly WorkspaceStatusDefinition[]
): string {
  const availableStatuses = coerceMobileWorkspaceStatuses(statuses)
  if (
    worktree.workspaceStatus &&
    availableStatuses.some((status) => status.id === worktree.workspaceStatus)
  ) {
    return worktree.workspaceStatus
  }
  if (availableStatuses.some((status) => status.id === DEFAULT_MOBILE_WORKSPACE_STATUS_ID)) {
    return DEFAULT_MOBILE_WORKSPACE_STATUS_ID
  }
  return availableStatuses[0]?.id ?? DEFAULT_MOBILE_WORKSPACE_STATUS_ID
}

export function getMobileWorkspaceStatusGroupKey(status: string): string {
  return `workspace-status:${encodeURIComponent(status)}`
}
