/**
 * Stress test for dead-terminal reproduction (setup-split flow).
 *
 * Why @headful: the dead-terminal bug is a WebGL canvas staleness issue — after
 * wrapInSplit() reparents the existing pane's container, the WebGL canvas can
 * fail to repaint. In headless mode WebGL is NEVER active, so the DOM fallback
 * renderer is used and the bug cannot manifest. Running headful ensures real
 * WebGL contexts matching production.
 *
 * See helpers/dead-terminal.ts for the shared worktree-creation helper that
 * replicates the exact activateAndRevealWorktree + ensureWorktreeHasInitialTerminal
 * production flow.
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
  waitForAllPanesToHaveContent,
  checkWebglState
} from './helpers/dead-terminal'

const STRESS_ITERATIONS = 5

test.describe('Dead Terminal Reproduction @headful', () => {
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

  test('@headful setup-split flow does not produce dead terminals', async ({ mantaPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)
    await checkWebglState(mantaPage, 'home-initial')

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const direction = i % 2 === 0 ? 'vertical' : 'horizontal'
      const newId = await createAndActivateWorktreeWithSetup(mantaPage, `setup-${i}`, direction)
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(mantaPage)
      await waitForActiveTerminalManager(mantaPage, 30_000)
      await waitForPaneCount(mantaPage, 2, 15_000)
      await checkWebglState(mantaPage, `setup-${i}`)
      await waitForAllPanesToHaveContent(mantaPage, `setup-${i} both panes`)

      await switchToWorktree(mantaPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(mantaPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful setup-split then switch-back does not leave panes dead', async ({ mantaPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const newId = await createAndActivateWorktreeWithSetup(
        mantaPage,
        `switchback-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(mantaPage)
      await waitForActiveTerminalManager(mantaPage, 30_000)
      await waitForPaneCount(mantaPage, 2, 15_000)
      await waitForAllPanesToHaveContent(mantaPage, `switchback-${i} initial`)

      await switchToWorktree(mantaPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await ensureTerminalVisible(mantaPage)
      await waitForActiveTerminalManager(mantaPage, 15_000)

      await switchToWorktree(mantaPage, newId)
      await expect.poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(mantaPage)
      await waitForActiveTerminalManager(mantaPage, 15_000)
      await waitForAllPanesToHaveContent(mantaPage, `switchback-${i} after return`)

      await switchToWorktree(mantaPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(mantaPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful rapid switching between many setup-split worktrees', async ({ mantaPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)

    const worktreeIds = [homeWorktreeId]
    for (let i = 0; i < 4; i++) {
      const newId = await createAndActivateWorktreeWithSetup(mantaPage, `multi-${i}`, 'vertical')
      createdWorktreeIds.push(newId)
      worktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(mantaPage)
      await waitForActiveTerminalManager(mantaPage, 30_000)
      await waitForPaneCount(mantaPage, 2, 15_000)
      await waitForAllPanesToHaveContent(mantaPage, `multi-create-${i}`)
    }

    for (let round = 0; round < 3; round++) {
      for (const wId of worktreeIds) {
        await switchToWorktree(mantaPage, wId)
        await expect.poll(async () => getActiveWorktreeId(mantaPage), { timeout: 10_000 }).toBe(wId)
        await ensureTerminalVisible(mantaPage)
        await waitForActiveTerminalManager(mantaPage, 15_000)
        await waitForAllPanesToHaveContent(mantaPage, `multi-r${round}-${wId.slice(0, 8)}`)
      }
    }
  })
})
