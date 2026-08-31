import { useMemo } from 'react'
import { buildSearchableBrowserPages } from '@/lib/browser-palette-page-entries'
import { searchBrowserPages, type SearchableBrowserPage } from '@/lib/browser-palette-search'
import {
  buildSearchableSimulatorTabs,
  searchSimulatorTabs,
  type SearchableSimulatorTab
} from '@/lib/simulator-palette-search'
import {
  buildSearchableWorkspaceTabs,
  searchWorkspaceTabs,
  type SearchableWorkspaceTab
} from '@/lib/workspace-tab-palette-search'
import {
  getOpenTabMatchRelevance,
  getWorktreeMatchRelevance,
  NO_MATCH_RELEVANCE
} from '@/lib/cmd-j-match-relevance'
import type {
  BrowserPaletteItem,
  OpenTabPaletteItem,
  SimulatorPaletteItem,
  WorkspaceTabPaletteItem,
  WorktreePaletteItem
} from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'
import type { WorktreeJumpPaletteWorktrees } from './use-worktree-jump-palette-worktrees'

const EMPTY_BROWSER_PAGE_ENTRIES: SearchableBrowserPage[] = []
const EMPTY_SIMULATOR_TAB_ENTRIES: SearchableSimulatorTab[] = []
const EMPTY_WORKSPACE_TAB_ENTRIES: SearchableWorkspaceTab[] = []

type WorktreeJumpPaletteOpenTabsInput = WorktreeJumpPaletteStoreState &
  WorktreeJumpPaletteWorktrees &
  Pick<WorktreeJumpPaletteFilter, 'repoMap'> &
  Pick<WorktreeJumpPaletteLocalState, 'deferredQuery'>

export function useWorktreeJumpPaletteOpenTabs({
  paletteStatusInputsActive,
  browserSortedWorktrees,
  repoMap,
  worktreeOrder,
  browserTabsByWorktree,
  browserPagesByWorkspace,
  activeBrowserTabId,
  activeWorktreeId,
  activeTabType,
  unifiedTabsByWorktree,
  activeGroupIdByWorktree,
  groupsByWorktree,
  tabsByWorktree,
  openFiles,
  agentStatusByPaneKey,
  retainedAgentsByPaneKey,
  sleepingAgentSessionsByPaneKey,
  activeTabId,
  activeTabIdByWorktree,
  activeFileId,
  activeFileIdByWorktree,
  activeTabTypeByWorktree,
  settings,
  deferredQuery,
  hasQuery,
  worktreeMatches,
  worktreeMap
}: WorktreeJumpPaletteOpenTabsInput) {
  const browserPageEntries = useMemo<SearchableBrowserPage[]>(() => {
    if (!paletteStatusInputsActive) {
      return EMPTY_BROWSER_PAGE_ENTRIES
    }
    return buildSearchableBrowserPages({
      worktrees: browserSortedWorktrees,
      repoMap,
      worktreeOrder,
      browserTabsByWorktree,
      browserPagesByWorkspace,
      activeBrowserTabId,
      activeWorktreeId,
      activeTabType
    })
  }, [
    paletteStatusInputsActive,
    activeBrowserTabId,
    activeTabType,
    activeWorktreeId,
    browserPagesByWorkspace,
    browserTabsByWorktree,
    browserSortedWorktrees,
    repoMap,
    worktreeOrder
  ])
  const browserMatches = useMemo(
    () => searchBrowserPages(browserPageEntries, deferredQuery.trim()),
    [browserPageEntries, deferredQuery]
  )
  const simulatorTabEntries = useMemo<SearchableSimulatorTab[]>(() => {
    if (!paletteStatusInputsActive) {
      return EMPTY_SIMULATOR_TAB_ENTRIES
    }
    return buildSearchableSimulatorTabs({
      worktrees: browserSortedWorktrees,
      repoMap,
      worktreeOrder,
      unifiedTabsByWorktree,
      activeGroupIdByWorktree,
      groupsByWorktree,
      activeWorktreeId,
      activeTabType
    })
  }, [
    paletteStatusInputsActive,
    activeGroupIdByWorktree,
    activeTabType,
    activeWorktreeId,
    browserSortedWorktrees,
    groupsByWorktree,
    repoMap,
    unifiedTabsByWorktree,
    worktreeOrder
  ])
  const simulatorMatches = useMemo(
    () => searchSimulatorTabs(simulatorTabEntries, deferredQuery.trim()),
    [simulatorTabEntries, deferredQuery]
  )
  const workspaceTabEntries = useMemo<SearchableWorkspaceTab[]>(() => {
    if (!paletteStatusInputsActive) {
      return EMPTY_WORKSPACE_TAB_ENTRIES
    }
    return buildSearchableWorkspaceTabs({
      worktrees: browserSortedWorktrees,
      repoMap,
      worktreeOrder,
      unifiedTabsByWorktree,
      tabsByWorktree,
      openFiles,
      agentStatusByPaneKey,
      retainedAgentsByPaneKey,
      sleepingAgentSessionsByPaneKey,
      activeGroupIdByWorktree,
      groupsByWorktree,
      activeWorktreeId,
      activeTabType,
      activeTabId,
      activeTabIdByWorktree,
      activeFileId,
      activeFileIdByWorktree,
      activeTabTypeByWorktree,
      generatedTitlesEnabled: settings?.tabAutoGenerateTitle === true
    })
  }, [
    paletteStatusInputsActive,
    activeFileId,
    activeFileIdByWorktree,
    activeGroupIdByWorktree,
    activeTabId,
    activeTabIdByWorktree,
    activeTabType,
    activeTabTypeByWorktree,
    activeWorktreeId,
    agentStatusByPaneKey,
    browserSortedWorktrees,
    groupsByWorktree,
    openFiles,
    repoMap,
    retainedAgentsByPaneKey,
    settings?.tabAutoGenerateTitle,
    sleepingAgentSessionsByPaneKey,
    tabsByWorktree,
    unifiedTabsByWorktree,
    worktreeOrder
  ])
  const workspaceTabMatches = useMemo(
    () => searchWorkspaceTabs(workspaceTabEntries, deferredQuery.trim()),
    [workspaceTabEntries, deferredQuery]
  )
  const worktreeRelevanceById = useMemo(() => {
    const relevanceById = new Map<string, number>()
    if (!hasQuery) {
      return relevanceById
    }
    for (const match of worktreeMatches) {
      const worktree = worktreeMap.get(match.worktreeId)
      if (worktree) {
        relevanceById.set(
          match.worktreeId,
          getWorktreeMatchRelevance(
            match,
            worktree,
            repoMap.get(worktree.repoId)?.displayName ?? ''
          )
        )
      }
    }
    return relevanceById
  }, [hasQuery, repoMap, worktreeMap, worktreeMatches])
  const worktreeItems = useMemo<WorktreePaletteItem[]>(() => {
    const items = worktreeMatches
      .map((match) => {
        const worktree = worktreeMap.get(match.worktreeId)
        return worktree
          ? { id: `worktree:${worktree.id}`, type: 'worktree' as const, match, worktree }
          : null
      })
      .filter((item): item is WorktreePaletteItem => item !== null)
    if (!hasQuery) {
      return items
    }
    return items.sort(
      (left, right) =>
        (worktreeRelevanceById.get(left.worktree.id) ?? NO_MATCH_RELEVANCE) -
        (worktreeRelevanceById.get(right.worktree.id) ?? NO_MATCH_RELEVANCE)
    )
  }, [hasQuery, worktreeMap, worktreeMatches, worktreeRelevanceById])
  const browserItems = useMemo<BrowserPaletteItem[]>(
    () =>
      browserMatches.map((result) => ({
        id: `browser-page:${result.pageId}`,
        type: 'browser-page' as const,
        result
      })),
    [browserMatches]
  )
  const simulatorItems = useMemo<SimulatorPaletteItem[]>(
    () =>
      simulatorMatches.map((result) => ({
        id: `simulator-tab:${result.tabId}`,
        type: 'simulator-tab' as const,
        result
      })),
    [simulatorMatches]
  )
  const workspaceTabItems = useMemo<WorkspaceTabPaletteItem[]>(
    () =>
      workspaceTabMatches.map((result) => ({
        id: `workspace-tab:${result.tabId}`,
        type: 'workspace-tab' as const,
        result
      })),
    [workspaceTabMatches]
  )
  const openTabItems = useMemo<OpenTabPaletteItem[]>(() => {
    const items = [...browserItems, ...simulatorItems, ...workspaceTabItems]
    const relevanceById = new Map(
      items.map((item) => [item.id, getOpenTabMatchRelevance(item.result)])
    )
    return items.sort((left, right) => {
      const relevance =
        (relevanceById.get(left.id) ?? NO_MATCH_RELEVANCE) -
        (relevanceById.get(right.id) ?? NO_MATCH_RELEVANCE)
      if (relevance !== 0) {
        return relevance
      }
      if (left.result.score !== right.result.score) {
        return left.result.score - right.result.score
      }
      return left.id.localeCompare(right.id)
    })
  }, [browserItems, simulatorItems, workspaceTabItems])

  return {
    browserPageEntries,
    simulatorTabEntries,
    workspaceTabEntries,
    worktreeRelevanceById,
    worktreeItems,
    browserItems,
    simulatorItems,
    workspaceTabItems,
    openTabItems
  }
}

export type WorktreeJumpPaletteOpenTabs = ReturnType<typeof useWorktreeJumpPaletteOpenTabs>
