import { useMemo } from 'react'
import {
  isAutomationGeneratedWorkspace,
  isCliCreatedWorkspace,
  isDetachedHeadWorkspace,
  isSleepingSweepExemptWorkspace
} from '@/components/sidebar/visible-worktrees'
import { isDefaultBranchWorkspace } from '@/components/sidebar/default-branch-workspace'
import { sortWorktreesSmart } from '@/components/sidebar/smart-sort'
import { buildWorktreeChecksReviewIndex } from '@/components/cmd-j/worktree-checks-review-index'
import { getLiveAgentStatusByWorktreeId, isInactiveWorkspace } from '@/lib/worktree-activity-state'
import { orderEmptyQueryWorktrees } from '@/lib/order-empty-query-worktrees'
import { getWorktreePaletteSearchScope, searchWorktrees } from '@/lib/worktree-palette-search'
import { getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import type { Worktree } from '../../../shared/worktree/types'
import { EMPTY_SORTED_WORKTREES } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'

type WorktreeJumpPaletteWorktreesInput = WorktreeJumpPaletteStoreState &
  Pick<WorktreeJumpPaletteFilter, 'filterPredicate' | 'repoMap' | 'repoByHostIdentity'> &
  Pick<WorktreeJumpPaletteLocalState, 'deferredQuery'>

export function useWorktreeJumpPaletteWorktrees({
  deferredQuery,
  repos,
  worktreesByRepo,
  agentStatusByPaneKey,
  tabsByWorktree,
  allWorktrees,
  filterPredicate,
  hideDefaultBranchWorkspace,
  hideAutomationGeneratedWorkspaces,
  hideCliCreatedWorkspaces,
  hideDetachedHeadWorkspaces,
  showSleepingWorkspaces,
  alwaysShowDefaultBranchWorkspace,
  ptyIdsByTabId,
  browserTabsByWorktree,
  activeWorktreeId,
  lastVisitedAtByWorktreeId,
  paletteStatusInputsActive,
  repoMap,
  runtimePaneTitlesByTabId,
  migrationUnsupportedByPtyId,
  terminalLayoutsByTabId,
  repoByHostIdentity,
  prCache,
  hostedReviewCache,
  settings,
  issueCache,
  workspacePortScan
}: WorktreeJumpPaletteWorktreesInput) {
  const hasQuery = deferredQuery.trim().length > 0
  const isLoading = repos.length > 0 && Object.keys(worktreesByRepo).length === 0
  const worktreeIdsWithLiveAgent = useMemo(
    () =>
      new Set(
        // The palette recomputes this snapshot when status inputs change; the
        // clock intentionally reflects the render that performs that snapshot.
        // oxlint-disable-next-line react/purity
        getLiveAgentStatusByWorktreeId(agentStatusByPaneKey, tabsByWorktree, Date.now()).keys()
      ),
    [agentStatusByPaneKey, tabsByWorktree]
  )
  const emptyQueryVisibleWorktrees = useMemo(
    () =>
      allWorktrees.filter((worktree) => {
        if (worktree.isArchived) {
          return false
        }
        if (filterPredicate && !filterPredicate.matchesWorktree(worktree)) {
          return false
        }
        if (hideDefaultBranchWorkspace && isDefaultBranchWorkspace(worktree)) {
          return false
        }
        if (hideAutomationGeneratedWorkspaces && isAutomationGeneratedWorkspace(worktree)) {
          return false
        }
        if (hideCliCreatedWorkspaces && isCliCreatedWorkspace(worktree)) {
          return false
        }
        if (hideDetachedHeadWorkspaces && isDetachedHeadWorkspace(worktree)) {
          return false
        }
        if (
          !showSleepingWorkspaces &&
          !isSleepingSweepExemptWorkspace(worktree, alwaysShowDefaultBranchWorkspace) &&
          isInactiveWorkspace(
            worktree.id,
            tabsByWorktree,
            ptyIdsByTabId,
            browserTabsByWorktree,
            worktreeIdsWithLiveAgent
          )
        ) {
          return false
        }
        return true
      }),
    [
      allWorktrees,
      alwaysShowDefaultBranchWorkspace,
      browserTabsByWorktree,
      filterPredicate,
      hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces,
      hideDefaultBranchWorkspace,
      hideDetachedHeadWorkspaces,
      ptyIdsByTabId,
      showSleepingWorkspaces,
      tabsByWorktree,
      worktreeIdsWithLiveAgent
    ]
  )
  const { visibleWorktreesForState, switchableWorktreesForRows } = useMemo(
    () =>
      orderEmptyQueryWorktrees({
        visibleWorktrees: emptyQueryVisibleWorktrees,
        activeWorktreeId,
        lastVisitedAtByWorktreeId
      }),
    [emptyQueryVisibleWorktrees, activeWorktreeId, lastVisitedAtByWorktreeId]
  )
  const searchScopeWorktrees = useMemo(() => {
    const scope = getWorktreePaletteSearchScope({
      hasQuery,
      allWorktrees,
      emptyQueryWorktrees: switchableWorktreesForRows
    })
    return hasQuery && filterPredicate ? scope.filter(filterPredicate.matchesWorktree) : scope
  }, [allWorktrees, filterPredicate, hasQuery, switchableWorktreesForRows])
  const browserSortedWorktrees = useMemo(() => {
    if (!paletteStatusInputsActive) {
      return EMPTY_SORTED_WORKTREES
    }
    const scope = filterPredicate
      ? allWorktrees.filter(filterPredicate.matchesWorktree)
      : allWorktrees
    return sortWorktreesSmart(
      scope,
      tabsByWorktree,
      repoMap,
      agentStatusByPaneKey,
      runtimePaneTitlesByTabId,
      ptyIdsByTabId,
      migrationUnsupportedByPtyId,
      terminalLayoutsByTabId
    )
  }, [
    paletteStatusInputsActive,
    allWorktrees,
    filterPredicate,
    tabsByWorktree,
    repoMap,
    agentStatusByPaneKey,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    migrationUnsupportedByPtyId,
    terminalLayoutsByTabId
  ])
  const sortedWorktrees = useMemo(
    () =>
      hasQuery
        ? browserSortedWorktrees.filter((worktree) => !worktree.isArchived)
        : searchScopeWorktrees,
    [hasQuery, browserSortedWorktrees, searchScopeWorktrees]
  )
  const worktreeMap = useMemo(() => {
    const map = new Map<string, Worktree>()
    for (const worktree of browserSortedWorktrees) {
      map.set(worktree.id, worktree)
    }
    return map
  }, [browserSortedWorktrees])
  const worktreeOrder = useMemo(
    () => new Map(browserSortedWorktrees.map((worktree, index) => [worktree.id, index])),
    [browserSortedWorktrees]
  )
  const checksReviewByWorktree = useMemo(
    () =>
      buildWorktreeChecksReviewIndex({
        worktrees: allWorktrees,
        repoByHostIdentity,
        prCache,
        hostedReviewCache,
        settings
      }),
    [allWorktrees, hostedReviewCache, prCache, repoByHostIdentity, settings]
  )
  const worktreeMatches = useMemo(
    () =>
      searchWorktrees(sortedWorktrees, deferredQuery.trim(), repoMap, {
        repoMapByHostIdentity: repoByHostIdentity,
        prCache,
        issueCache,
        workspacePortsByWorktreeId: getWorkspacePortsByWorktreeId(workspacePortScan),
        checksReviewByWorktree
      }),
    [
      sortedWorktrees,
      deferredQuery,
      repoMap,
      repoByHostIdentity,
      prCache,
      issueCache,
      workspacePortScan,
      checksReviewByWorktree
    ]
  )
  return {
    hasQuery,
    isLoading,
    visibleWorktreesForState,
    switchableWorktreesForRows,
    searchScopeWorktrees,
    browserSortedWorktrees,
    worktreeMap,
    worktreeOrder,
    worktreeMatches
  }
}

export type WorktreeJumpPaletteWorktrees = ReturnType<typeof useWorktreeJumpPaletteWorktrees>
