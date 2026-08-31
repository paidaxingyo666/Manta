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
import {
  getWorktreePaletteSearchScope,
  searchWorktreeDocuments
} from '@/lib/worktree-palette-search'
import { buildWorktreePaletteDocuments } from '@/lib/worktree-palette-document'
import { getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import {
  buildPaletteWorktreeIndex,
  resolvePaletteWorktree,
  resolvePaletteRepoForWorktree
} from '@/lib/palette-repo-resolution'
import { getWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'
import { getPaletteHostBadge } from '@/components/cmd-j/palette-host-badge'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  getPairedDeviceIdsByEnvironment,
  isWorkspaceFromOtherDevice
} from '@/components/sidebar/workspace-creator-visibility'
import type { Worktree } from '../../../shared/worktree/types'
import { EMPTY_SORTED_WORKTREES } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'

type WorktreeJumpPaletteWorktreesInput = WorktreeJumpPaletteStoreState &
  Pick<
    WorktreeJumpPaletteFilter,
    'filterPredicate' | 'repoMap' | 'repoByHostIdentity' | 'hostOptions' | 'hostFilterActive'
  > &
  Pick<WorktreeJumpPaletteLocalState, 'paletteSearchQuery'>

export function useWorktreeJumpPaletteWorktrees({
  paletteSearchQuery,
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
  hideWorkspacesFromOtherDevices,
  showSleepingWorkspaces,
  alwaysShowDefaultBranchWorkspace,
  ptyIdsByTabId,
  browserTabsByWorktree,
  activeWorktreeId,
  activeWorkspaceExecutionHostId,
  runtimeEnvironments,
  runtimeStatusByEnvironmentId,
  lastVisitedAtByWorktreeId,
  paletteStatusInputsActive,
  repoMap,
  runtimePaneTitlesByTabId,
  migrationUnsupportedByPtyId,
  terminalLayoutsByTabId,
  repoByHostIdentity,
  hostOptions,
  hostFilterActive,
  prCache,
  hostedReviewCache,
  settings,
  issueCache,
  workspacePortScan
}: WorktreeJumpPaletteWorktreesInput) {
  const hasQuery = paletteSearchQuery.length > 0
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
  const pairedDeviceIdsByEnvironment = useMemo(
    () =>
      hideWorkspacesFromOtherDevices
        ? getPairedDeviceIdsByEnvironment(runtimeEnvironments, runtimeStatusByEnvironmentId)
        : EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
    [hideWorkspacesFromOtherDevices, runtimeEnvironments, runtimeStatusByEnvironmentId]
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
          hideWorkspacesFromOtherDevices &&
          isWorkspaceFromOtherDevice(worktree, pairedDeviceIdsByEnvironment)
        ) {
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
      hideWorkspacesFromOtherDevices,
      pairedDeviceIdsByEnvironment,
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
        activeWorkspaceExecutionHostId,
        lastVisitedAtByWorktreeId
      }),
    [
      emptyQueryVisibleWorktrees,
      activeWorktreeId,
      activeWorkspaceExecutionHostId,
      lastVisitedAtByWorktreeId
    ]
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
  const paletteWorktreeIndex = useMemo(
    () => buildPaletteWorktreeIndex(browserSortedWorktrees),
    [browserSortedWorktrees]
  )
  const resolveWorktree = useMemo(
    () =>
      (worktreeId: string, hostId: Worktree['hostId'] | undefined): Worktree | undefined =>
        resolvePaletteWorktree(paletteWorktreeIndex, worktreeId, hostId),
    [paletteWorktreeIndex]
  )
  // Keep a host-qualified map for consumers that only have an identity key.
  const worktreeMap = useMemo(() => {
    const map = new Map<string, Worktree>()
    for (const worktree of browserSortedWorktrees) {
      map.set(getWorktreeHostIdentity(worktree), worktree)
      if (!map.has(worktree.id)) {
        map.set(worktree.id, worktree)
      }
    }
    return map
  }, [browserSortedWorktrees])
  const worktreeOrder = useMemo(
    () =>
      new Map(
        browserSortedWorktrees.map((worktree, index) => [getWorktreeHostIdentity(worktree), index])
      ),
    [browserSortedWorktrees]
  )
  const hostLabelByWorktreeId = useMemo(() => {
    const labels = new Map<string, string>()
    for (const worktree of allWorktrees) {
      const repo = resolvePaletteRepoForWorktree(worktree, repoMap, repoByHostIdentity)
      const badge = getPaletteHostBadge(repo, hostOptions, hostFilterActive)
      if (badge) {
        labels.set(getWorktreeHostIdentity(worktree), badge.label)
      }
    }
    return labels
  }, [allWorktrees, hostFilterActive, hostOptions, repoByHostIdentity, repoMap])
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
  const worktreeDocuments = useMemo(
    () =>
      buildWorktreePaletteDocuments(
        allWorktrees.filter((worktree) => !worktree.isArchived),
        {
          repoMap,
          repoMapByHostIdentity: repoByHostIdentity,
          prCache,
          issueCache,
          workspacePortsByWorktreeId: getWorkspacePortsByWorktreeId(workspacePortScan),
          checksReviewByWorktree,
          hostLabelByWorktreeId
        }
      ),
    [
      allWorktrees,
      checksReviewByWorktree,
      issueCache,
      prCache,
      repoByHostIdentity,
      repoMap,
      workspacePortScan,
      hostLabelByWorktreeId
    ]
  )
  const worktreeMatches = useMemo(
    () =>
      searchWorktreeDocuments({
        worktrees: sortedWorktrees,
        query: paletteSearchQuery,
        documents: worktreeDocuments,
        repoMap,
        repoMapByHostIdentity: repoByHostIdentity,
        checksReviewByWorktree
      }),
    [
      checksReviewByWorktree,
      paletteSearchQuery,
      repoByHostIdentity,
      repoMap,
      sortedWorktrees,
      worktreeDocuments
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
    resolveWorktree,
    paletteWorktreeIndex,
    worktreeOrder,
    worktreeMatches
  }
}

export type WorktreeJumpPaletteWorktrees = ReturnType<typeof useWorktreeJumpPaletteWorktrees>
