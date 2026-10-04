import { test, expect } from './helpers/manta-app'
import { waitForSessionReady, waitForActiveWorktree } from './helpers/store'
import { seedLineageScenario } from './worktree-lineage-state'
import { waitForLineageScrollFixtureReady } from './worktree-lineage-scroll-readiness'

test.use({ launchEnv: { MANTA_BACKGROUND_LAUNCH: '1' } })

test('keyboard and chip preserve the scrolled parent, and unfolding opens the sidebar', async ({
  mantaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
  await mantaPage.emulateMedia({ reducedMotion: 'reduce' })
  await mantaPage.setViewportSize({ width: 1200, height: 800 })
  const family = await seedLineageScenario(mantaPage)
  await mantaPage.evaluate(async ({ parentId, childId }) => {
    const store = window.__store
    if (!store) {
      throw new Error('Missing store')
    }
    const state = store.getState()
    const parent = Object.values(state.worktreesByRepo)
      .flat()
      .find((row) => row.id === parentId)
    if (!parent) {
      throw new Error('Missing parent')
    }
    const surrounding = Array.from({ length: 40 }, (_, index) => ({
      ...parent,
      id: `scroll-card-${index}`,
      instanceId: `scroll-instance-${index}`,
      displayName: `Surrounding workspace ${index}`,
      isMainWorktree: false,
      isPinned: false,
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      sortOrder: 40 - index
    }))
    store.setState({
      sortBy: 'manual',
      worktreesByRepo: {
        ...state.worktreesByRepo,
        [parent.repoId]: [
          ...state.worktreesByRepo[parent.repoId].map((row) => ({
            ...row,
            sortOrder: row.id === parentId ? 16.5 : row.id === childId ? 16.4 : row.sortOrder
          })),
          ...surrounding
        ]
      }
    })
    await store.getState().setKeybindingOverride('sidebar.childWorkspaces.toggle', ['Mod+Alt+H'])
  }, family)

  const sidebar = mantaPage.locator('[data-worktree-sidebar]')
  const parentRow = sidebar
    .locator(`[role="option"][data-worktree-id=${JSON.stringify(family.parentId)}]`)
    .first()
  const childRow = sidebar
    .locator(`[role="option"][data-worktree-id=${JSON.stringify(family.childId)}]`)
    .first()
  await mantaPage.getByRole('button', { name: 'Reveal active workspace' }).click()
  await expect(parentRow).toBeVisible()
  await parentRow.evaluate((row) => row.scrollIntoView({ block: 'center' }))
  await expect.poll(() => sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const geometry = () =>
    parentRow.evaluate((row) => ({
      top: row.getBoundingClientRect().top,
      scrollTop: row.closest('[data-worktree-sidebar]')?.scrollTop ?? 0
    }))
  await waitForLineageScrollFixtureReady(mantaPage, family.parentId)
  const before = await geometry()
  await mantaPage.mouse.move(1150, 400)
  await mantaPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  await expect(childRow).toBeHidden()
  await expect.poll(async () => Math.abs((await geometry()).top - before.top)).toBeLessThan(2)
  expect((await geometry()).scrollTop).toBeGreaterThan(0)
  const collapsedProof = testInfo.outputPath('keyboard-collapsed-parent-anchor.png')
  await sidebar.screenshot({ path: collapsedProof })
  await testInfo.attach('keyboard-collapsed-parent-anchor', {
    path: collapsedProof,
    contentType: 'image/png'
  })

  await parentRow.getByRole('button', { name: 'Show 1 child workspace' }).click()
  await expect(childRow).toBeVisible()
  await expect.poll(async () => Math.abs((await geometry()).top - before.top)).toBeLessThan(2)
  await mantaPage.mouse.move(1150, 400)
  await mantaPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  await expect(childRow).toBeHidden()
  await mantaPage.evaluate(() => window.__store?.getState().setSidebarOpen(false))
  await expect(sidebar).toBeHidden()
  await mantaPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  await expect(sidebar).toBeVisible()
  await expect(childRow).toBeVisible()
})
