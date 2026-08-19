/**
 * E2E tests for terminal pane scrollback retention.
 *
 * User Prompt:
 * - terminal panes retain state when switching tabs and when you make / close a pane / switch worktrees
 */

import { test, expect } from './helpers/manta-app'
import {
  discoverActivePtyId,
  execInTerminal,
  closeActiveTerminalPane,
  countVisibleTerminalPanes,
  focusLastTerminalPane,
  splitActiveTerminalPane,
  waitForTerminalOutput,
  waitForPaneCount,
  getTerminalContent
} from './helpers/terminal'
import {
  getActiveWorktreeId,
  getActiveTabType,
  getWorktreeTabs,
  getAllWorktreeIds,
  switchToOtherWorktree,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

// Why: keep the suite serial so the headful pane tests never ask Playwright to
// open multiple visible Electron windows at once.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  /**
   * User Prompt:
   * - terminal panes retain state when switching tabs and when you make / close a pane / switch worktrees
   */
  test('terminal pane retains content when switching tabs and back', async ({ mantaPage }) => {
    // Write a unique marker to the current terminal
    const ptyId = await discoverActivePtyId(mantaPage)
    const marker = `RETAIN_TEST_${Date.now()}`
    await execInTerminal(mantaPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(mantaPage, marker)

    // Create a new terminal tab (Cmd/Ctrl+T) to switch away
    const worktreeId = (await getActiveWorktreeId(mantaPage))!
    await pressShortcut(mantaPage, 't')

    // Wait for the new tab to appear
    await expect
      .poll(async () => (await getWorktreeTabs(mantaPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)

    // Verify we're still on a terminal tab
    const activeType = await getActiveTabType(mantaPage)
    expect(activeType).toBe('terminal')

    // Switch back to the previous tab with Cmd/Ctrl+Shift+[
    await pressShortcut(mantaPage, 'BracketLeft', { shift: true })

    // Verify the marker is still present
    await expect
      .poll(async () => (await getTerminalContent(mantaPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)

    // Clean up the extra tab
    await pressShortcut(mantaPage, 'BracketRight', { shift: true })
    await pressShortcut(mantaPage, 'w')
  })

  /**
   * User Prompt:
   * - terminal panes retain state when switching tabs and when you make / close a pane / switch worktrees
   */
  test('terminal pane retains content when splitting and closing a pane', async ({ mantaPage }) => {
    // Write a unique marker to the current terminal
    const ptyId = await discoverActivePtyId(mantaPage)
    const marker = `SPLIT_RETAIN_${Date.now()}`
    await execInTerminal(mantaPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(mantaPage, marker)

    const panesBefore = await countVisibleTerminalPanes(mantaPage)

    // Split the terminal right
    await splitActiveTerminalPane(mantaPage, 'vertical')
    await waitForPaneCount(mantaPage, panesBefore + 1)

    await focusLastTerminalPane(mantaPage)
    await closeActiveTerminalPane(mantaPage)
    await waitForPaneCount(mantaPage, panesBefore)

    // The original pane should still have our marker
    await expect
      .poll(async () => (await getTerminalContent(mantaPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)
  })

  /**
   * User Prompt:
   * - terminal panes retain state when switching tabs and when you make / close a pane / switch worktrees
   */
  test('terminal pane retains content when switching worktrees and back', async ({ mantaPage }) => {
    const allWorktreeIds = await getAllWorktreeIds(mantaPage)
    if (allWorktreeIds.length < 2) {
      test.skip(true, 'Need at least 2 worktrees to test worktree switching')
      return
    }

    const worktreeId = (await getActiveWorktreeId(mantaPage))!

    // Write a unique marker to the current terminal
    const ptyId = await discoverActivePtyId(mantaPage)
    const marker = `WT_RETAIN_${Date.now()}`
    await execInTerminal(mantaPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(mantaPage, marker)

    // Switch to a different worktree via the store
    const otherId = await switchToOtherWorktree(mantaPage, worktreeId)
    expect(otherId).not.toBeNull()
    await expect.poll(async () => getActiveWorktreeId(mantaPage), { timeout: 5_000 }).toBe(otherId)

    // Switch back to the original worktree
    await switchToWorktree(mantaPage, worktreeId)
    await expect
      .poll(async () => getActiveWorktreeId(mantaPage), { timeout: 5_000 })
      .toBe(worktreeId)

    // Why: after a worktree round-trip, the split-group container transitions
    // from hidden back to visible. In headful Electron runs the terminal tree
    // can take longer than a single render turn to rebind its serialize addon
    // after the worktree activation cascade. Waiting directly for the retained
    // marker proves the user-visible behavior without failing early on the
    // intermediate manager-remount timing.
    await ensureTerminalVisible(mantaPage)

    // The terminal should still contain our marker
    await expect
      .poll(async () => (await getTerminalContent(mantaPage)).includes(marker), { timeout: 20_000 })
      .toBe(true)
  })
})
