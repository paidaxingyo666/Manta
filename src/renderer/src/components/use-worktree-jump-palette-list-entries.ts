import { useEffect, useMemo } from 'react'
import {
  getWorktreePaletteSelectionItemIds,
  CREATE_WORKTREE_ITEM_ID
} from '@/lib/worktree-palette-create-action'
import { translate } from '@/i18n/i18n'
import {
  appendPaletteListEntries,
  CONTINUED_SECTION_HEADER_ID_SUFFIX,
  type PaletteItem,
  type PaletteListEntry
} from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteOpenTabs } from './use-worktree-jump-palette-open-tabs'
import type { WorktreeJumpPaletteSections } from './use-worktree-jump-palette-sections'
import type { WorktreeJumpPaletteWorktrees } from './use-worktree-jump-palette-worktrees'

type WorktreeJumpPaletteListEntriesInput = WorktreeJumpPaletteSections &
  Pick<WorktreeJumpPaletteWorktrees, 'hasQuery'> &
  Pick<WorktreeJumpPaletteOpenTabs, 'worktreeItems'> &
  Pick<WorktreeJumpPaletteLocalState, 'autoSelectedItemIdRef'>

export function useWorktreeJumpPaletteListEntries({
  hasQuery,
  openTabsLeadSections,
  paletteSections,
  showCreateAction,
  worktreeItems,
  autoSelectedItemIdRef
}: WorktreeJumpPaletteListEntriesInput) {
  const listEntries = useMemo<PaletteListEntry[]>(() => {
    const entries: PaletteListEntry[] = []
    const {
      visibleWorktreeItems,
      visibleProjectTargetItems,
      visibleMiddleItems,
      visibleOpenTabItems,
      showWorktreeHint,
      worktreeOverflowCount,
      projectTargetOverflowCount,
      middleOverflowCount,
      openTabOverflowCount,
      multiPrimaryFirstScreen,
      multiPrimaryLayout
    } = paletteSections
    const pushOverflowHint = (id: string, overflowCount: number): void => {
      if (overflowCount > 0) {
        entries.push({
          id,
          type: 'hint',
          label: translate(
            'worktreeJumpPalette.renderCapOverflow',
            '{{value0}} more — scroll or keep typing to narrow',
            { value0: overflowCount }
          )
        })
      }
    }
    const showWorktreeHeader = visibleWorktreeItems.length > 0
    const showOpenTabsHeader = visibleOpenTabItems.length > 0
    const showProjectTargetHeader = visibleProjectTargetItems.length > 0
    const showMiddleHeader = visibleMiddleItems.length > 0
    const pushOpenTabsHeader = (idSuffix = ''): void => {
      if (!showOpenTabsHeader) {
        return
      }
      entries.push({
        id: `__header_open_tabs__${idSuffix}`,
        type: 'section-header',
        label: hasQuery
          ? translate('auto.components.WorktreeJumpPalette.50a1d11d5b', 'Open Tabs')
          : translate(
              'auto.components.WorktreeJumpPalette.recentChatsTerminalsHeader',
              'Recent Chats & Terminals'
            )
      })
    }
    const pushWorktreesHeader = (idSuffix = ''): void => {
      if (!showWorktreeHeader) {
        return
      }
      entries.push({
        id: `__header_worktrees__${idSuffix}`,
        type: 'section-header',
        label: hasQuery
          ? translate('auto.components.WorktreeJumpPalette.worktreesHeader', 'Worktrees')
          : translate(
              'auto.components.WorktreeJumpPalette.recentWorktreesHeader',
              'Recent Worktrees'
            )
      })
    }
    const pushWorktreeSection = (): void => {
      if (visibleWorktreeItems.length === 0) {
        return
      }
      pushWorktreesHeader()
      appendPaletteListEntries(entries, visibleWorktreeItems)
      if (showWorktreeHint) {
        entries.push({
          id: '__hint_worktree_cap__',
          type: 'hint',
          label: translate(
            'auto.components.WorktreeJumpPalette.dabd819ca1',
            'Type to see all {{value0}} worktrees',
            { value0: worktreeItems.length }
          )
        })
      }
      pushOverflowHint('__hint_worktree_overflow__', worktreeOverflowCount)
    }
    const pushOpenTabSection = (): void => {
      if (visibleOpenTabItems.length === 0) {
        return
      }
      pushOpenTabsHeader()
      appendPaletteListEntries(entries, visibleOpenTabItems)
      pushOverflowHint('__hint_open_tab_overflow__', openTabOverflowCount)
    }
    const pushProjectAndMiddleSections = (): void => {
      if (visibleProjectTargetItems.length > 0) {
        if (showProjectTargetHeader) {
          entries.push({
            id: '__header_projects_groups__',
            type: 'section-header',
            label: translate(
              'auto.components.WorktreeJumpPalette.projectsGroupsHeader',
              'Projects & Groups'
            )
          })
        }
        appendPaletteListEntries(entries, visibleProjectTargetItems)
        pushOverflowHint('__hint_project_overflow__', projectTargetOverflowCount)
      }
      if (visibleMiddleItems.length > 0) {
        if (showMiddleHeader) {
          entries.push({
            id: '__header_actions_settings__',
            type: 'section-header',
            label: translate('auto.components.WorktreeJumpPalette.088d66d980', 'Actions & Settings')
          })
        }
        appendPaletteListEntries(entries, visibleMiddleItems)
        pushOverflowHint('__hint_middle_overflow__', middleOverflowCount)
      }
    }
    if (!hasQuery) {
      pushOpenTabSection()
      pushWorktreeSection()
      return entries
    }
    if (multiPrimaryFirstScreen && multiPrimaryLayout) {
      const leadingHintId = openTabsLeadSections
        ? '__hint_open_tab_overflow__'
        : '__hint_worktree_overflow__'
      const trailingHintId = openTabsLeadSections
        ? '__hint_worktree_overflow__'
        : '__hint_open_tab_overflow__'
      const pushLeadingHeader = (idSuffix = ''): void => {
        if (openTabsLeadSections) {
          pushOpenTabsHeader(idSuffix)
        } else {
          pushWorktreesHeader(idSuffix)
        }
      }
      const pushTrailingHeader = (idSuffix = ''): void => {
        if (openTabsLeadSections) {
          pushWorktreesHeader(idSuffix)
        } else {
          pushOpenTabsHeader(idSuffix)
        }
      }
      pushLeadingHeader()
      appendPaletteListEntries(entries, multiPrimaryLayout.leadingPreview as PaletteItem[])
      pushOverflowHint(leadingHintId, multiPrimaryLayout.leadingMoreCount)
      pushTrailingHeader()
      appendPaletteListEntries(entries, multiPrimaryLayout.trailingFloor as PaletteItem[])
      const hasLeadingRest = multiPrimaryLayout.leadingRest.length > 0
      if (hasLeadingRest) {
        pushLeadingHeader(CONTINUED_SECTION_HEADER_ID_SUFFIX)
        appendPaletteListEntries(entries, multiPrimaryLayout.leadingRest as PaletteItem[])
      }
      if (multiPrimaryLayout.trailingRest.length > 0) {
        if (hasLeadingRest) {
          pushTrailingHeader(CONTINUED_SECTION_HEADER_ID_SUFFIX)
        }
        appendPaletteListEntries(entries, multiPrimaryLayout.trailingRest as PaletteItem[])
      }
      pushOverflowHint(trailingHintId, multiPrimaryLayout.trailingHardOverflowCount)
      pushProjectAndMiddleSections()
      if (showCreateAction) {
        entries.push({ id: CREATE_WORKTREE_ITEM_ID, type: 'create-worktree' })
      }
      return entries
    }
    if (openTabsLeadSections) {
      pushOpenTabSection()
    }
    pushWorktreeSection()
    pushProjectAndMiddleSections()
    if (!openTabsLeadSections) {
      pushOpenTabSection()
    }
    if (showCreateAction) {
      entries.push({ id: CREATE_WORKTREE_ITEM_ID, type: 'create-worktree' })
    }
    return entries
  }, [hasQuery, openTabsLeadSections, paletteSections, showCreateAction, worktreeItems.length])
  const selectableItems = useMemo<PaletteItem[]>(
    () =>
      listEntries.filter(
        (entry): entry is PaletteItem =>
          entry.type !== 'section-header' &&
          entry.type !== 'hint' &&
          entry.type !== 'create-worktree'
      ),
    [listEntries]
  )
  const selectionItemIds = useMemo(
    () => getWorktreePaletteSelectionItemIds(listEntries),
    [listEntries]
  )
  useEffect(() => {
    autoSelectedItemIdRef.current = selectionItemIds[0] ?? null
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the controller ref preserves its original stable identity.
  }, [selectionItemIds])
  return { listEntries, selectableItems, selectionItemIds }
}

export type WorktreeJumpPaletteListEntries = ReturnType<typeof useWorktreeJumpPaletteListEntries>
