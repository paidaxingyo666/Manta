import type { PickerOption } from '../components/PickerModal'
import type { MobileGroupMode, MobileSortMode } from './workspace-view-settings'
import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'

export const workspaceSortOptions = localizedConstant((): PickerOption<MobileSortMode>[] => [
  // Why: desktop and persisted state keep the `smart` key, while mobile shows the product label.
  {
    value: 'smart',
    label: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.ea011082cd',
      'Agent activity'
    ),
    subtitle: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.45c98be3a6',
      'Agents that need attention, then recent activity'
    )
  },
  {
    value: 'name',
    label: translate('auto.mobile.src.worktree.workspace.list.picker.options.b50aa4cb12', 'Name'),
    subtitle: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.05a18882b1',
      'Alphabetical by name'
    )
  },
  {
    value: 'recent',
    label: translate('auto.mobile.src.worktree.workspace.list.picker.options.db127de800', 'Recent'),
    subtitle: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.7a0926f2a2',
      'Most recent output first'
    )
  },
  {
    value: 'repo',
    label: translate('auto.mobile.src.worktree.workspace.list.picker.options.bf91f59896', 'Repo'),
    subtitle: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.c87d5b3f15',
      'Repository, then workspace name'
    )
  },
  {
    value: 'manual',
    label: translate('auto.mobile.src.worktree.workspace.list.picker.options.172192615e', 'Manual'),
    subtitle: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.cb54ef416b',
      'Server order'
    )
  }
])

export const workspaceGroupOptions = localizedConstant((): PickerOption<MobileGroupMode>[] => [
  {
    value: 'none',
    label: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.22addae6ca',
      'No Grouping'
    )
  },
  {
    value: 'workspaceStatus',
    label: translate('auto.mobile.src.worktree.workspace.list.picker.options.a0166ed3f7', 'Status')
  },
  {
    value: 'repo',
    label: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.057d8da776',
      'Repository'
    )
  },
  {
    value: 'prStatus',
    label: translate(
      'auto.mobile.src.worktree.workspace.list.picker.options.d4173f4bae',
      'PR Status'
    )
  }
])
