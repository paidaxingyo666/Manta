import { useMemo } from 'react'
import { useShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import { getOpenTabMatchRelevance, NO_MATCH_RELEVANCE } from '@/lib/cmd-j-match-relevance'
import { getWorktreePaletteCreateActionState } from '@/lib/worktree-palette-create-action'
import {
  capPaletteSection,
  layoutMultiPrimaryPaletteSections
} from '@/components/cmd-j/palette-section-render-cap'
import {
  DIGIT_INDEX_ACTION_ID,
  DIGIT_INDEX_ADDRESSABLE_ROWS,
  EMPTY_QUERY_RECENT_TAB_CAP,
  EMPTY_QUERY_ROW_BUDGET,
  EMPTY_QUERY_WORKTREE_CAP,
  type OpenTabPaletteItem,
  type PaletteItem,
  type WorktreePaletteItem
} from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteOpenTabs } from './use-worktree-jump-palette-open-tabs'
import type { WorktreeJumpPaletteProjectTargets } from './use-worktree-jump-palette-project-targets'
import type { WorktreeJumpPaletteQuickActions } from './use-worktree-jump-palette-quick-actions'
import type { WorktreeJumpPaletteRecentTabs } from './use-worktree-jump-palette-recent-tabs'
import type { WorktreeJumpPaletteWorktrees } from './use-worktree-jump-palette-worktrees'

type WorktreeJumpPaletteSectionsInput = WorktreeJumpPaletteOpenTabs &
  WorktreeJumpPaletteRecentTabs &
  WorktreeJumpPaletteProjectTargets &
  Pick<WorktreeJumpPaletteQuickActions, 'middleItems'> &
  Pick<WorktreeJumpPaletteWorktrees, 'hasQuery'> &
  Pick<WorktreeJumpPaletteLocalState, 'deferredQuery'>

export function useWorktreeJumpPaletteSections({
  hasQuery,
  worktreeItems,
  worktreeRelevanceById,
  openTabItems,
  recentTabItems,
  projectTargetItems,
  middleItems,
  deferredQuery
}: WorktreeJumpPaletteSectionsInput) {
  const openTabsLeadSections = useMemo(() => {
    if (!hasQuery) {
      return true
    }
    const bestWorktree = worktreeItems[0]
    const bestWorktreeRelevance = bestWorktree
      ? (worktreeRelevanceById.get(bestWorktree.worktree.id) ?? NO_MATCH_RELEVANCE)
      : NO_MATCH_RELEVANCE
    const bestOpenTab = openTabItems[0]
    const bestOpenTabRelevance = bestOpenTab
      ? getOpenTabMatchRelevance(bestOpenTab.result)
      : NO_MATCH_RELEVANCE
    return bestOpenTabRelevance <= bestWorktreeRelevance
  }, [hasQuery, openTabItems, worktreeItems, worktreeRelevanceById])
  const paletteSections = useMemo(() => {
    // Why: the empty-query trim lives here, not in `recentTabItems`, so the trimmed tail becomes an
    // overflow count the section can offer as "See more" instead of silently vanishing.
    const openTabs = hasQuery
      ? capPaletteSection(openTabItems)
      : capPaletteSection(recentTabItems, EMPTY_QUERY_RECENT_TAB_CAP)
    const worktreeCap = hasQuery
      ? Infinity
      : Math.min(
          openTabs.visible.length === 0 ? EMPTY_QUERY_ROW_BUDGET : EMPTY_QUERY_WORKTREE_CAP,
          Math.max(1, EMPTY_QUERY_ROW_BUDGET - openTabs.visible.length)
        )
    const worktrees = hasQuery
      ? capPaletteSection(worktreeItems)
      : { visible: worktreeItems.slice(0, worktreeCap), overflowCount: 0 }
    const projectTargets = capPaletteSection(hasQuery ? projectTargetItems : [])
    const middle = capPaletteSection(hasQuery ? middleItems : [])
    const showWorktreeHint = !hasQuery && worktreeItems.length > worktreeCap
    const multiPrimaryFirstScreen =
      hasQuery && openTabs.visible.length > 0 && worktrees.visible.length > 0
    const multiPrimaryLayout = multiPrimaryFirstScreen
      ? layoutMultiPrimaryPaletteSections<WorktreePaletteItem | OpenTabPaletteItem>({
          leadingItems: openTabsLeadSections ? openTabItems : worktreeItems,
          trailingItems: openTabsLeadSections ? worktreeItems : openTabItems
        })
      : null
    return {
      visibleWorktreeItems: worktrees.visible as PaletteItem[],
      worktreeOverflowCount: worktrees.overflowCount,
      visibleProjectTargetItems: projectTargets.visible as PaletteItem[],
      projectTargetOverflowCount: projectTargets.overflowCount,
      visibleMiddleItems: middle.visible as PaletteItem[],
      middleOverflowCount: middle.overflowCount,
      visibleOpenTabItems: openTabs.visible as PaletteItem[],
      openTabOverflowCount: openTabs.overflowCount,
      showWorktreeHint,
      multiPrimaryFirstScreen,
      multiPrimaryLayout
    }
  }, [
    worktreeItems,
    projectTargetItems,
    middleItems,
    openTabItems,
    recentTabItems,
    hasQuery,
    openTabsLeadSections
  ])
  // Why: badges number the snapshotted recent rows only — ⌘N is meaningless on a typed query, and an
  // expanded section leaves its unaddressable rows unbadged rather than advertising ⌘10.
  const recentTabShortcutIndexById = useMemo(
    () =>
      new Map(
        hasQuery
          ? []
          : paletteSections.visibleOpenTabItems
              .slice(0, DIGIT_INDEX_ADDRESSABLE_ROWS)
              .map((item, index) => [item.id, index])
      ),
    [hasQuery, paletteSections]
  )
  const digitShortcutModifiers =
    useShortcutKeyComboDetails(DIGIT_INDEX_ACTION_ID)[0]?.keys.slice(0, -1) ?? []
  const { createWorktreeName, showCreateAction } = useMemo(
    () => getWorktreePaletteCreateActionState({ query: deferredQuery }),
    [deferredQuery]
  )
  return {
    openTabsLeadSections,
    paletteSections,
    recentTabShortcutIndexById,
    digitShortcutModifiers,
    createWorktreeName,
    showCreateAction
  }
}

export type WorktreeJumpPaletteSections = ReturnType<typeof useWorktreeJumpPaletteSections>
