/**
 * Aggressive stress tests for dead-terminal reproduction.
 *
 * These tests target specific failure vectors beyond the basic setup-split flow:
 * - Forced WebGL context loss (simulating Chromium memory pressure)
 * - Rapid switching during the ~200ms scheduleSplitScrollRestore window
 *
 * All tests require @headful mode for WebGL to be active.
 */

import { test, expect } from './helpers/manta-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { waitForActiveTerminalManager, waitForPaneCount } from './helpers/terminal'
import {
  createAndActivateWorktreeWithSetup,
  removeWorktreeViaStore,
  waitForAllPanesToHaveContent
} from './helpers/dead-terminal'

const STRESS_ITERATIONS = 5

test.describe('Dead Terminal Stress @headful', () => {
  const createdWorktreeIds: string[] = []

  test.beforeEach(async ({ mantaPage }) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
    await ensureTerminalVisible(mantaPage)

    await mantaPage.evaluate(async () => {
      const state = window.__store?.getState()
      if (!state) {
        return
      }
      state.updateSettings({ setupScriptLaunchMode: 'split-vertical' })
    })
  })

  test.afterEach(async ({ mantaPage }) => {
    for (const id of createdWorktreeIds) {
      await removeWorktreeViaStore(mantaPage, id)
    }
    createdWorktreeIds.length = 0
  })

  /**
   * Force WebGL context loss on visible canvases immediately after a setup
   * split. In production, Chromium reclaims WebGL contexts under memory
   * pressure — especially with many worktrees open. The recovery path is:
   * onContextLoss → dispose WebGL → DOM fallback → rAF → fit + refresh.
   */
  test('@headful setup-split with forced WebGL context loss recovers', async ({ mantaPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const newId = await createAndActivateWorktreeWithSetup(mantaPage, `ctxloss-${i}`, 'vertical')
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(mantaPage)
      await waitForActiveTerminalManager(mantaPage, 30_000)
      await waitForPaneCount(mantaPage, 2, 15_000)

      const lostCount = await mantaPage.evaluate(() => {
        const canvases = document.querySelectorAll('.pane canvas:not(.xterm-link-layer)')
        let lost = 0
        for (const canvas of canvases) {
          const gl =
            (canvas as HTMLCanvasElement).getContext('webgl2') ??
            (canvas as HTMLCanvasElement).getContext('webgl')
          if (gl) {
            const ext = gl.getExtension('WEBGL_lose_context')
            if (ext) {
              ext.loseContext()
              lost++
            }
          }
        }
        return lost
      })
      if (lostCount > 0) {
        console.log(`[ctxloss-${i}] Forced context loss on ${lostCount} canvases`)
      }

      await mantaPage.waitForTimeout(500)
      await waitForAllPanesToHaveContent(mantaPage, `ctxloss-${i} after context loss`)

      await switchToWorktree(mantaPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(mantaPage, newId)
      createdWorktreeIds.pop()
    }
  })

  /**
   * Switch worktrees WITHOUT waiting for the split to settle. This hits the
   * race between wrapInSplit() reparenting, WebGL context creation during
   * resumeRendering(), and the scheduleSplitScrollRestore 200ms timer.
   */
  test('@headful rapid worktree switching during setup-split lifecycle', async ({ mantaPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)

    for (let i = 0; i < 3; i++) {
      const newId = await createAndActivateWorktreeWithSetup(mantaPage, `rapid-${i}`, 'vertical')
      createdWorktreeIds.push(newId)

      // Switch away during the ~200ms scheduleSplitScrollRestore window
      await mantaPage.waitForTimeout(50)
      await switchToWorktree(mantaPage, homeWorktreeId)
      await mantaPage.waitForTimeout(50)

      // Switch back — triggers resumeRendering on partially-initialized panes
      await switchToWorktree(mantaPage, newId)
      await expect.poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(mantaPage)
      await waitForActiveTerminalManager(mantaPage, 30_000)
      await waitForPaneCount(mantaPage, 2, 15_000)
      await waitForAllPanesToHaveContent(mantaPage, `rapid-${i} after return`)

      await switchToWorktree(mantaPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(mantaPage, newId)
      createdWorktreeIds.pop()
    }
  })
})
