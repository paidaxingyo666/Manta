import React from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { TabGroupLayoutNode } from '../../../shared/tab-types'
import { useAppStore } from '../store'
import type { ActivityTerminalPortalTarget } from './activity/activity-terminal-portal'
import { useBrowserAutomationVisibilityForAny } from './browser-pane/browser-automation-visibility'
import { useBrowserMobileDriverForAny } from '@/lib/pane-manager/browser-mobile-driver-state'
import TabGroupSplitLayout from './tab-group/TabGroupSplitLayout'
import TerminalPaneOverlayLayer from './terminal-pane/TerminalPaneOverlayLayer'
import { RetainedBrowserPaneOverlayLayer } from './browser-pane/BrowserPaneOverlayLayer'
import EmulatorPaneOverlayLayer from './emulator-pane/EmulatorPaneOverlayLayer'
import AiVaultSessionDropLayer from './tab-group/AiVaultSessionDropLayer'

export const WorktreeSplitSurface = React.memo(function WorktreeSplitSurface({
  worktreeId,
  worktreePath,
  layout,
  focusedGroupId,
  isVisible,
  shouldMeasureHiddenWorktree,
  shouldColdParkTerminalPanes,
  isForceParked,
  activityTerminalPortals,
  backgroundMountTabIds,
  activationDeferredMountTabIds
}: {
  worktreeId: string
  worktreePath: string
  layout: TabGroupLayoutNode
  focusedGroupId?: string
  isVisible: boolean
  shouldMeasureHiddenWorktree: boolean
  shouldColdParkTerminalPanes: boolean
  isForceParked: boolean
  activityTerminalPortals: ActivityTerminalPortalTarget[]
  backgroundMountTabIds: ReadonlySet<string> | null
  activationDeferredMountTabIds: ReadonlySet<string> | null
}): React.JSX.Element {
  const browserPageIds = useAppStore(
    useShallow((state) =>
      (state.browserTabsByWorktree[worktreeId] ?? []).flatMap((tab) =>
        tab.pageIds && tab.pageIds.length > 0 ? tab.pageIds : [tab.activePageId ?? tab.id]
      )
    )
  )
  const hasAutomationVisibleBrowser = useBrowserAutomationVisibilityForAny(browserPageIds)
  const hasMobileDrivenBrowser = useBrowserMobileDriverForAny(browserPageIds)
  const shouldKeepPaintable =
    shouldMeasureHiddenWorktree || hasAutomationVisibleBrowser || hasMobileDrivenBrowser

  return (
    <div
      className={
        isVisible
          ? 'absolute inset-0 flex'
          : shouldKeepPaintable
            ? 'absolute inset-0 flex opacity-0 pointer-events-none'
            : 'absolute inset-0 hidden'
      }
      inert={!isVisible}
      aria-hidden={!isVisible}
    >
      <TabGroupSplitLayout
        layout={layout}
        worktreeId={worktreeId}
        focusedGroupId={focusedGroupId}
        isWorktreeActive={isVisible}
      />
      <TerminalPaneOverlayLayer
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isWorktreeActive={isVisible}
        coldParkTerminalPanes={shouldColdParkTerminalPanes}
        isForceParked={isForceParked}
        shouldMeasureHiddenWorktree={shouldMeasureHiddenWorktree}
        activityTerminalPortals={activityTerminalPortals}
        backgroundMountTabIds={backgroundMountTabIds}
        activationDeferredMountTabIds={activationDeferredMountTabIds}
      />
      <RetainedBrowserPaneOverlayLayer
        worktreeId={worktreeId}
        isWorktreeActive={isVisible}
        mountEligible={
          isVisible ||
          backgroundMountTabIds === null ||
          hasAutomationVisibleBrowser ||
          hasMobileDrivenBrowser
        }
      />
      {isVisible || backgroundMountTabIds === null ? (
        <EmulatorPaneOverlayLayer worktreeId={worktreeId} isWorktreeActive={isVisible} />
      ) : null}
      <AiVaultSessionDropLayer worktreeId={worktreeId} enabled={isVisible} />
    </div>
  )
})
