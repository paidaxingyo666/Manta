import type { Mock } from 'vitest'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'

export const SPLIT_WORKTREE_ID = 'repo::/worktree'
export const SPLIT_SOURCE = {
  worktreeId: SPLIT_WORKTREE_ID,
  tabId: toWebTerminalSurfaceTabId('tab-1'),
  leafId: 'leaf-1'
}

/** Store state where `hostTabId` owns the split source pane while `activeHostTabId` is on screen. */
export function makeSplitSourceState(
  hostTabId: string,
  leafId = 'leaf-1',
  activeHostTabId = hostTabId
): Record<string, unknown> {
  const tabId = toWebTerminalSurfaceTabId(hostTabId)
  const activeTabId = toWebTerminalSurfaceTabId(activeHostTabId)
  const tabs = [
    {
      id: tabId,
      worktreeId: SPLIT_WORKTREE_ID,
      contentType: 'terminal',
      ptyId: 'remote:web-env-1@@terminal-1'
    },
    ...(activeTabId === tabId
      ? []
      : [{ id: activeTabId, worktreeId: SPLIT_WORKTREE_ID, contentType: 'terminal' }])
  ]
  return {
    activeWorktreeId: SPLIT_WORKTREE_ID,
    activeWorkspaceExecutionHostId: 'runtime:web-env-1',
    activeTabType: 'terminal',
    activeTabTypeByWorktree: { [SPLIT_WORKTREE_ID]: 'terminal' },
    activeTabIdByWorktree: { [SPLIT_WORKTREE_ID]: activeTabId },
    tabsByWorktree: { [SPLIT_WORKTREE_ID]: tabs },
    unifiedTabsByWorktree: { [SPLIT_WORKTREE_ID]: tabs },
    groupsByWorktree: {},
    terminalLayoutsByTabId: {
      [tabId]: {
        activeLeafId: leafId,
        ptyIdsByLeafId: { [leafId]: 'remote:web-env-1@@terminal-1' }
      },
      ...(activeTabId === tabId ? {} : { [activeTabId]: { activeLeafId: 'active-leaf' } })
    }
  }
}

export function stubSplitSourceTab(getState: Mock, hostTabId: string): void {
  getState.mockReturnValue(makeSplitSourceState(hostTabId))
}

export function makeSplitResult(leafId: string): unknown {
  return {
    id: leafId,
    ok: true,
    result: { split: { handle: leafId, tabId: 'tab-1', paneRuntimeId: -1, leafId } }
  }
}

/** The host tabs snapshot replayed after a split; every split suite reads back the same one. */
export function makeHostTabsListResponse(): unknown {
  return {
    id: 'list',
    ok: true,
    result: {
      worktree: SPLIT_WORKTREE_ID,
      publicationEpoch: 'epoch-1',
      snapshotVersion: 2,
      activeGroupId: null,
      activeTabId: null,
      activeTabType: 'terminal',
      tabs: []
    }
  }
}
