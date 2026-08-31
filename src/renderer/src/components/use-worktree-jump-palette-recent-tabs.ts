import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  buildExplicitEntriesByTabId,
  type TabPaneInputSources
} from '@/components/sidebar/smart-attention'
import {
  buildFocusedGroupTabRecency,
  orderRecentWorkspaceTabs,
  type RecentWorkspaceTabRow
} from '@/lib/recent-workspace-tab-rows'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import {
  EMPTY_RECENT_TAB_ORDER,
  type OpenTabRecentRow,
  type PaletteItem
} from './worktree-jump-palette-model'
import { shouldIncludeOpenTabInRecentSection } from './worktree-jump-palette-recent-inclusion'
import type { WorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteOpenTabs } from './use-worktree-jump-palette-open-tabs'
import type { WorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'
import type { WorktreeJumpPaletteWorktrees } from './use-worktree-jump-palette-worktrees'

type WorktreeJumpPaletteRecentTabsInput = WorktreeJumpPaletteStoreState &
  WorktreeJumpPaletteOpenTabs &
  Pick<WorktreeJumpPaletteWorktrees, 'worktreeMap' | 'hasQuery'> &
  Pick<WorktreeJumpPaletteFilter, 'filterActive'> &
  Pick<WorktreeJumpPaletteLocalState, 'query' | 'autoSelectedItemIdRef' | 'setSelectedItemId'>

export function useWorktreeJumpPaletteRecentTabs({
  tabsByWorktree,
  agentStatusByPaneKey,
  migrationUnsupportedByPtyId,
  ptyIdsByTabId,
  runtimePaneTitlesByTabId,
  terminalLayoutsByTabId,
  openTabItems,
  worktreeMap,
  unreadTerminalTabs,
  unreadAgentCompletionPanes,
  visible,
  hasQuery,
  query,
  filterActive,
  lastVisitedAtByWorktreeId,
  activeGroupIdByWorktree,
  groupsByWorktree,
  autoSelectedItemIdRef,
  setSelectedItemId
}: WorktreeJumpPaletteRecentTabsInput) {
  const terminalTabsById = useMemo(() => {
    const byId = new Map<string, TerminalTab>()
    for (const tabs of Object.values(tabsByWorktree)) {
      for (const tab of tabs ?? []) {
        byId.set(tab.id, tab)
      }
    }
    return byId
  }, [tabsByWorktree])
  const recentTabPaneSources = useMemo<TabPaneInputSources>(
    () => ({
      entriesByTabId: buildExplicitEntriesByTabId(
        agentStatusByPaneKey,
        migrationUnsupportedByPtyId
      ),
      ptyIdsByTabId,
      runtimePaneTitlesByTabId,
      terminalLayoutsByTabId
    }),
    [
      agentStatusByPaneKey,
      migrationUnsupportedByPtyId,
      ptyIdsByTabId,
      runtimePaneTitlesByTabId,
      terminalLayoutsByTabId
    ]
  )
  const openTabRecentRows = useMemo<OpenTabRecentRow[]>(() => {
    const entries: OpenTabRecentRow[] = []
    for (const item of openTabItems) {
      const worktree = worktreeMap.get(item.result.worktreeId)
      if (!worktree) {
        continue
      }
      entries.push({
        item,
        worktree,
        row: {
          id: item.id,
          worktreeId: worktree.id,
          unifiedTabId: item.type === 'browser-page' ? null : item.result.tabId,
          terminalTab:
            item.type === 'workspace-tab' && item.result.contentType === 'terminal'
              ? (terminalTabsById.get(item.result.entityId) ?? null)
              : null,
          worktreeLastActivityAt: worktree.lastActivityAt
        }
      })
    }
    return entries
  }, [openTabItems, terminalTabsById, worktreeMap])
  const recentTabRowById = useMemo(
    () => new Map(openTabRecentRows.map(({ row }) => [row.id, row])),
    [openTabRecentRows]
  )
  const recentTabRows = useMemo<RecentWorkspaceTabRow[]>(() => {
    const now = Date.now()
    const rows: RecentWorkspaceTabRow[] = []
    for (const { item, worktree, row } of openTabRecentRows) {
      if (
        shouldIncludeOpenTabInRecentSection({
          item,
          worktree,
          row,
          paneSources: recentTabPaneSources,
          unreadTerminalTabs,
          unreadAgentCompletionPanes,
          now
        })
      ) {
        rows.push(row)
      }
    }
    return rows
  }, [openTabRecentRows, recentTabPaneSources, unreadAgentCompletionPanes, unreadTerminalTabs])
  const [recentTabOrder, setRecentTabOrder] = useState<readonly string[]>(EMPTY_RECENT_TAB_ORDER)
  const recentTabOrderCapturedRef = useRef(false)
  const recentTabOrderAttentionReadyRef = useRef(false)
  const recentOrderAttentionIncomplete = useMemo(() => {
    for (const { item, worktree, row } of openTabRecentRows) {
      if (
        item.type !== 'workspace-tab' ||
        item.result.contentType !== 'terminal' ||
        row.terminalTab ||
        worktree.isArchived
      ) {
        continue
      }
      return true
    }
    return false
  }, [openTabRecentRows])
  useLayoutEffect(() => {
    if (!visible) {
      recentTabOrderCapturedRef.current = false
      recentTabOrderAttentionReadyRef.current = false
      autoSelectedItemIdRef.current = null
      setRecentTabOrder(EMPTY_RECENT_TAB_ORDER)
      return
    }
    if (hasQuery || query.length > 0 || filterActive) {
      return
    }
    if (
      recentTabOrderCapturedRef.current &&
      (recentTabOrderAttentionReadyRef.current || recentOrderAttentionIncomplete)
    ) {
      return
    }
    const order = orderRecentWorkspaceTabs({
      rows: recentTabRows,
      paneSources: recentTabPaneSources,
      now: Date.now(),
      lastVisitedAtByWorktreeId,
      focusedGroupTabRecency: buildFocusedGroupTabRecency(activeGroupIdByWorktree, groupsByWorktree)
    })
    if (order.length === 0) {
      recentTabOrderCapturedRef.current = false
      recentTabOrderAttentionReadyRef.current = false
      setRecentTabOrder(EMPTY_RECENT_TAB_ORDER)
      return
    }
    recentTabOrderCapturedRef.current = true
    recentTabOrderAttentionReadyRef.current = !recentOrderAttentionIncomplete
    setRecentTabOrder(order)
    setSelectedItemId((current) =>
      current === '' || current === autoSelectedItemIdRef.current ? '' : current
    )
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- controller refs and setters preserve their original stable identities.
  }, [
    activeGroupIdByWorktree,
    filterActive,
    groupsByWorktree,
    hasQuery,
    lastVisitedAtByWorktreeId,
    query.length,
    recentOrderAttentionIncomplete,
    recentTabPaneSources,
    recentTabRows,
    visible
  ])
  const recentTabItems = useMemo<PaletteItem[]>(() => {
    const itemById = new Map(openTabItems.map((item) => [item.id, item]))
    return recentTabOrder.flatMap((id) => itemById.get(id) ?? [])
  }, [openTabItems, recentTabOrder])

  return { recentTabPaneSources, recentTabRowById, recentTabItems }
}

export type WorktreeJumpPaletteRecentTabs = ReturnType<typeof useWorktreeJumpPaletteRecentTabs>
