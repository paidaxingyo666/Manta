import { translate } from '../i18n/i18n'
import { localizedConstant } from '../i18n/localized-constant'

/** The screens `app/h/_layout.tsx` declares, shared so the native and page stacks cannot drift. */
// Titles are localized, so the list is rebuilt per language.
export const hostStackScreens = localizedConstant(
  () =>
    [
      { name: '[hostId]/index', title: translate('m.layout.7aca81e533', 'Host') },
      { name: '[hostId]/edit', title: translate('m.layout.d3370f3d6f', 'Edit host') },
      { name: '[hostId]/accounts', title: translate('m.layout.295637a5f9', 'Accounts') },
      { name: '[hostId]/tasks', title: translate('m.layout.6137d5f7ea', 'Tasks') },
      {
        name: '[hostId]/session/[worktreeId]',
        title: translate('m.layout.c2dc55fe2e', 'Terminal')
      },
      {
        name: '[hostId]/source-control/[worktreeId]',
        title: translate('m.layout.319ab14fcb', 'Source Control')
      },
      {
        name: '[hostId]/agent-history/[worktreeId]',
        title: translate('m.layout.6adb9b8189', 'Agent Session History')
      },
      { name: '[hostId]/review/[worktreeId]', title: translate('m.layout.01c108c5c2', 'Changes') },
      { name: '[hostId]/pr/[worktreeId]', title: translate('m.layout.7ceda7cfcf', 'Pull Request') },
      // Dev-flag only: redirects to the host screen unless the hybrid shell flag is on.
      { name: '[hostId]/web', title: translate('m.layout.c2d88db1d7', 'Workspace') },
      // Last, and matched last: every pathname above has a file of its own, so this takes only what
      // expo-router would otherwise send to Unmatched. Declared for the title alone — an undeclared
      // child still renders, appended after these with this group's screenOptions.
      { name: '[hostId]/[...page]', title: translate('m.layout.c2d88db1d7', 'Workspace') }
    ] as const
)

/** Tablet split view swaps the detail pane instantly; phones slide. */
export type HostStackAnimation = 'none' | 'default'
