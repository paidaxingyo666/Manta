import { useEffect } from 'react'
import { useAppStore } from '../store'
import {
  isBrowserAutomationVisible,
  onBrowserAutomationVisibilityChange
} from './browser-pane/browser-automation-visibility'
import {
  isBrowserPageMobileDriven,
  onBrowserDriverChange
} from '@/lib/pane-manager/browser-mobile-driver-state'
import {
  browserTabVisibilityPageIds,
  selectBrowserGuestEvictionWorktreeIds,
  touchBrowserGuestWorktreeRecency,
  worktreeHoldsLiveBrowserGuests
} from './browser-pane/browser-guest-worktree-retention'
import {
  hasActiveBrowserPageDownload,
  installBrowserPageDownloadActivityTracking
} from './browser-pane/browser-page-download-activity'
import { hasLiveBrowserGuest } from './browser-pane/webview-registry'
import { destroyWorktreeBrowserGuests } from '../store/slices/browser-webview-cleanup'
import type { TerminalParkingFoundation } from './use-terminal-parking-foundation'

export function useTerminalBrowserRetention(controller: TerminalParkingFoundation): void {
  const {
    browserGuestRetentionBudgetEnabled,
    browserGuestRetentionRevision,
    browserGuestWorktreeRecencyRef,
    mountedWorktreeIdsRef,
    renderedActiveWorktreeId,
    setBrowserGuestRetentionRevision,
    workspaceSurfaces
  } = controller

  useEffect(() => {
    const invalidateRetention = (): void => {
      setBrowserGuestRetentionRevision((revision) => revision + 1)
    }
    const removeDownloadTracking = installBrowserPageDownloadActivityTracking(invalidateRetention)
    const removeAutomationTracking = onBrowserAutomationVisibilityChange(invalidateRetention)
    const removeMobileTracking = onBrowserDriverChange(invalidateRetention)
    return () => {
      removeDownloadTracking()
      removeAutomationTracking()
      removeMobileTracking()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the controller setter preserves its original stable identity.
  }, [])

  useEffect(() => {
    if (!renderedActiveWorktreeId) {
      return
    }
    const recency = browserGuestWorktreeRecencyRef.current
    touchBrowserGuestWorktreeRecency(recency, renderedActiveWorktreeId)
    const surfaceIds = new Set(workspaceSurfaces.map((workspace) => workspace.id))
    for (let index = recency.length - 1; index >= 0; index--) {
      if (!surfaceIds.has(recency[index])) {
        recency.splice(index, 1)
      }
    }
    if (!browserGuestRetentionBudgetEnabled) {
      return
    }
    const state = useAppStore.getState()
    const recencyIds = new Set(recency)
    const orderedWorktreeIds = [
      ...recency,
      ...workspaceSurfaces.map((workspace) => workspace.id).filter((id) => !recencyIds.has(id))
    ]
    const evictedWorktreeIds = selectBrowserGuestEvictionWorktreeIds({
      orderedWorktreeIds,
      activeWorktreeId: renderedActiveWorktreeId,
      isRetained: (worktreeId) => mountedWorktreeIdsRef.current.has(worktreeId),
      holdsLiveGuests: (worktreeId) =>
        worktreeHoldsLiveBrowserGuests(
          state.browserTabsByWorktree[worktreeId] ?? [],
          state.browserPagesByWorkspace,
          hasLiveBrowserGuest
        ),
      isEvictable: (worktreeId) =>
        !(state.browserTabsByWorktree[worktreeId] ?? []).some((tab) =>
          browserTabVisibilityPageIds(tab).some(
            (pageId) =>
              isBrowserAutomationVisible(pageId) ||
              isBrowserPageMobileDriven(pageId) ||
              hasActiveBrowserPageDownload(pageId)
          )
        )
    })
    for (const worktreeId of evictedWorktreeIds) {
      destroyWorktreeBrowserGuests(
        state.browserTabsByWorktree,
        state.browserPagesByWorkspace,
        worktreeId
      )
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- controller refs preserve their original stable identities.
  }, [
    renderedActiveWorktreeId,
    workspaceSurfaces,
    browserGuestRetentionBudgetEnabled,
    browserGuestRetentionRevision
  ])
}
