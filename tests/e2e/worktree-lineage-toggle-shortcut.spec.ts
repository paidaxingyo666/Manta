import type { Page } from '@stablyai/playwright-test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './helpers/manta-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/manta-restart'
import { seedLineageScenario, seedWorkspaceLiveTerminal } from './worktree-lineage-state'

test.use({ launchEnv: { MANTA_BACKGROUND_LAUNCH: '1' } })

const ACTION_ID = 'sidebar.childWorkspaces.toggle' as const
const CHORD = 'ControlOrMeta+Alt+KeyH'

function sidebarWorktreeRow(page: Page, worktreeId: string) {
  return page
    .locator(
      `[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(worktreeId)}]`
    )
    .first()
}

async function waitForLineageWorktrees(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const store = window.__store
          if (!store) {
            return 0
          }
          for (const repo of store.getState().repos) {
            await store.getState().fetchWorktrees(repo.id)
          }
          return Object.values(store.getState().worktreesByRepo)
            .flat()
            .filter((worktree) => !worktree.isArchived).length
        }),
      { timeout: 30_000 }
    )
    .toBeGreaterThanOrEqual(2)
}

async function captureEvidence(page: Page, name: string): Promise<void> {
  if (process.env.MANTA_CAPTURE_EVIDENCE !== '1') {
    return
  }
  const directory = join(process.cwd(), 'pr-evidence')
  mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: join(directory, name) })
}

async function setToggleBinding(page: Page, bindings: string[] | null): Promise<void> {
  await page.evaluate(
    async ({ actionId, bindings }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      await (bindings
        ? state.setKeybindingOverride(actionId, bindings)
        : state.resetKeybindingOverride(actionId))
    },
    { actionId: ACTION_ID, bindings }
  )
}

async function movePointerOffSidebar(page: Page): Promise<void> {
  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    })))
  await page.mouse.move(viewport.width - 20, viewport.height / 2)
}

async function observeShortcutClaim(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyH') {
        document.body.dataset.childToggleClaimed = String(event.defaultPrevented)
      }
    })
  })
}

test.describe('Toggle Child Workspaces shortcut', () => {
  test.beforeEach(async ({ mantaPage, electronApp }) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  })

  test.afterEach(async ({ mantaPage }) => {
    await setToggleBinding(mantaPage, null)
  })

  test('Settings exposes the unbound action and records an assigned shortcut', async ({
    mantaPage
  }) => {
    await mantaPage.evaluate(async () => {
      await window.__store?.getState().updateSettings({ uiLanguage: 'en' })
      window.__store?.getState().openSettingsPage()
    })
    await mantaPage.getByPlaceholder('Search settings').fill('shortcuts')
    const search = mantaPage.getByPlaceholder('Search command or keys')
    await expect(search).toBeVisible()
    await search.fill('Toggle Child Workspaces')
    await expect(mantaPage.getByText('Toggle Child Workspaces', { exact: true })).toBeVisible()
    const add = mantaPage.getByRole('button', { name: 'Add shortcut for Toggle Child Workspaces' })
    await expect(add).toBeVisible()
    await captureEvidence(mantaPage, 'child-toggle-settings-unbound.png')

    await add.click()
    const recorder = mantaPage.locator('[data-shortcut-recorder-active]')
    await expect(recorder).toBeVisible()
    await recorder.press(CHORD)
    await expect(
      mantaPage.getByRole('button', { name: 'Change shortcut for Toggle Child Workspaces' })
    ).toBeVisible()
    await captureEvidence(mantaPage, 'child-toggle-settings-assigned.png')
  })

  test('hides and shows children of the active or hovered workspace', async ({ mantaPage }) => {
    const { parentId, childId } = await seedLineageScenario(mantaPage)
    await setToggleBinding(mantaPage, ['Mod+Alt+H'])
    const parentRow = sidebarWorktreeRow(mantaPage, parentId)
    const childRow = sidebarWorktreeRow(mantaPage, childId)

    await parentRow.click()
    await expect(parentRow).toHaveAttribute('aria-current', 'page')
    await expect(childRow).toBeVisible()
    await captureEvidence(mantaPage, 'child-toggle-sidebar-expanded.png')

    // No hovered card: the active parent is the target.
    await movePointerOffSidebar(mantaPage)
    await mantaPage.keyboard.press(CHORD)
    await expect(childRow).toBeHidden()
    await expect(parentRow.getByRole('button', { name: 'Show 1 child workspace' })).toBeVisible()
    await captureEvidence(mantaPage, 'child-toggle-sidebar-collapsed.png')

    await mantaPage.keyboard.press(CHORD)
    await expect(childRow).toBeVisible()
    await expect(parentRow.getByRole('button', { name: 'Hide 1 child workspace' })).toBeVisible()

    await childRow.click()
    await expect(childRow).toHaveAttribute('aria-current', 'page')
    await movePointerOffSidebar(mantaPage)
    await mantaPage.keyboard.press(CHORD)
    await expect(childRow).toBeHidden()
    await mantaPage.keyboard.press(CHORD)
    await expect(childRow).toBeVisible()
    await parentRow.click()

    // A hovered leaf child folds its parent.
    await childRow.hover()
    await mantaPage.keyboard.press(CHORD)
    await expect(childRow).toBeHidden()
    await expect(parentRow.getByRole('button', { name: 'Show 1 child workspace' })).toBeVisible()

    // A hovered parent unfolds its own children.
    await parentRow.hover()
    await mantaPage.keyboard.press(CHORD)
    await expect(childRow).toBeVisible()
  })

  test('a modal keeps its shortcut input while the parent chip is visible', async ({
    mantaPage
  }) => {
    const { parentId, childId } = await seedLineageScenario(mantaPage)
    await setToggleBinding(mantaPage, ['Mod+Alt+H'])
    await mantaPage.evaluate(() => window.__store?.getState().openModal('worktree-palette'))
    await expect(mantaPage.getByRole('dialog')).toBeVisible()
    await mantaPage.getByRole('dialog').evaluate((dialog) => {
      dialog.setAttribute('tabindex', '-1')
      dialog.focus()
    })
    await mantaPage.keyboard.press(CHORD)
    await expect(
      sidebarWorktreeRow(mantaPage, parentId).getByRole('button', {
        name: 'Hide 1 child workspace',
        includeHidden: true
      })
    ).toBeVisible()
    await expect(sidebarWorktreeRow(mantaPage, childId)).toBeVisible()
    await mantaPage.keyboard.press('Escape')
  })

  test('a hovered parent takes precedence over another active family', async ({ mantaPage }) => {
    const { parentId, childId } = await seedLineageScenario(mantaPage)
    await setToggleBinding(mantaPage, ['Mod+Alt+H'])
    const other = await mantaPage.evaluate(
      ({ parentId, childId }) => {
        const store = window.__store
        if (!store) {
          throw new Error('Missing store')
        }
        const state = store.getState()
        const worktrees = Object.values(state.worktreesByRepo).flat()
        const parent = worktrees.find((worktree) => worktree.id === parentId)
        const child = worktrees.find((worktree) => worktree.id === childId)
        const edge = state.worktreeLineageById[childId]
        if (!parent || !child || !edge) {
          throw new Error('Missing seeded family')
        }
        const otherParent = {
          ...parent,
          id: `${parentId}-other`,
          instanceId: 'other-parent',
          displayName: 'Another parent'
        }
        const otherChild = {
          ...child,
          id: `${childId}-other`,
          instanceId: 'other-child',
          displayName: 'Another child'
        }
        store.setState({
          worktreesByRepo: {
            ...state.worktreesByRepo,
            [parent.repoId]: [...state.worktreesByRepo[parent.repoId], otherParent, otherChild]
          },
          worktreeLineageById: {
            ...state.worktreeLineageById,
            [otherChild.id]: {
              ...edge,
              worktreeId: otherChild.id,
              worktreeInstanceId: otherChild.instanceId,
              parentWorktreeId: otherParent.id,
              parentWorktreeInstanceId: otherParent.instanceId
            }
          }
        })
        return { parentId: otherParent.id, childId: otherChild.id }
      },
      { parentId, childId }
    )
    await sidebarWorktreeRow(mantaPage, other.parentId).hover()
    await mantaPage.keyboard.press(CHORD)
    await expect(sidebarWorktreeRow(mantaPage, other.childId)).toBeHidden()
    await expect(sidebarWorktreeRow(mantaPage, childId)).toBeVisible()
    await captureEvidence(mantaPage, 'child-toggle-hover-precedence.png')
  })

  test('a focused floating workspace keeps the shortcut input', async ({ mantaPage }) => {
    const { parentId, childId } = await seedLineageScenario(mantaPage)
    await setToggleBinding(mantaPage, ['Mod+Alt+H'])
    await mantaPage.getByRole('button', { name: 'Show floating workspace', exact: true }).click()
    const panel = mantaPage.locator('[data-floating-terminal-panel][aria-hidden="false"]')
    await expect(panel).toBeVisible()
    await panel.locator('[data-floating-terminal-shortcut-surface]').first().focus()
    await mantaPage.keyboard.press(CHORD)
    await expect(
      sidebarWorktreeRow(mantaPage, parentId).getByRole('button', { name: 'Hide 1 child workspace' })
    ).toBeVisible()
    await expect(sidebarWorktreeRow(mantaPage, childId)).toBeVisible()
    await captureEvidence(mantaPage, 'child-toggle-floating-guard.png')
  })

  test('a stale child instance leaves no chip and does not claim the chord', async ({
    mantaPage
  }) => {
    const { parentId, childId } = await seedLineageScenario(mantaPage)
    await setToggleBinding(mantaPage, ['Mod+Alt+H'])
    await mantaPage.evaluate((childId) => {
      window.__store?.setState((state) => ({
        worktreesByRepo: Object.fromEntries(
          Object.entries(state.worktreesByRepo).map(([repoId, rows]) => [
            repoId,
            rows.map((row) =>
              row.id === childId ? { ...row, instanceId: 'recreated-child' } : row
            )
          ])
        )
      }))
    }, childId)
    const parentRow = sidebarWorktreeRow(mantaPage, parentId)
    await expect(parentRow.getByRole('button', { name: /child workspace/ })).toHaveCount(0)
    await parentRow.click()
    await mantaPage.locator('[data-worktree-sidebar]').focus()
    await movePointerOffSidebar(mantaPage)
    await observeShortcutClaim(mantaPage)
    await mantaPage.keyboard.press(CHORD)
    await expect(mantaPage.locator('body')).toHaveAttribute('data-child-toggle-claimed', 'false')
    await expect(sidebarWorktreeRow(mantaPage, childId)).toBeVisible()
    await captureEvidence(mantaPage, 'child-toggle-stale-no-chip.png')
  })

  test('folder cards pass the chord through while another family has a chip', async ({
    mantaPage
  }) => {
    const { parentId, childId } = await seedLineageScenario(mantaPage)
    await setToggleBinding(mantaPage, ['Mod+Alt+H'])
    const folderKey = 'folder:child-toggle-folder'
    await mantaPage.evaluate(() => {
      const store = window.__store
      const repo = store?.getState().repos[0]
      if (!store || !repo) {
        throw new Error('Missing seeded project')
      }
      store.setState({
        projectGroups: [
          {
            id: 'child-toggle-group',
            name: 'Folder project',
            parentPath: repo.path,
            parentGroupId: null,
            createdFrom: 'manual',
            tabOrder: 0,
            isCollapsed: false,
            color: null,
            createdAt: 1,
            updatedAt: 1
          }
        ],
        folderWorkspaces: [
          {
            id: 'child-toggle-folder',
            projectGroupId: 'child-toggle-group',
            name: 'Folder without a child chip',
            folderPath: repo.path,
            executionHostId: 'local',
            linkedTask: null,
            comment: '',
            isArchived: false,
            isUnread: false,
            isPinned: false,
            sortOrder: 0,
            lastActivityAt: 1,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      })
    })
    const folder = sidebarWorktreeRow(mantaPage, folderKey)
    await expect(folder).toBeVisible()
    await expect(folder.getByRole('button', { name: /child workspace/ })).toHaveCount(0)
    await sidebarWorktreeRow(mantaPage, parentId).click()
    await mantaPage.locator('[data-worktree-sidebar]').focus()
    await folder.hover()
    await observeShortcutClaim(mantaPage)
    await mantaPage.keyboard.press(CHORD)
    await expect(mantaPage.locator('body')).toHaveAttribute('data-child-toggle-claimed', 'false')
    await expect(sidebarWorktreeRow(mantaPage, childId)).toBeVisible()
    await folder.click()
    await expect(folder).toHaveAttribute('aria-current', 'page')
    await mantaPage.locator('[data-worktree-sidebar]').focus()
    await movePointerOffSidebar(mantaPage)
    await mantaPage.keyboard.press(CHORD)
    await expect(mantaPage.locator('body')).toHaveAttribute('data-child-toggle-claimed', 'false')
    await expect(sidebarWorktreeRow(mantaPage, childId)).toBeVisible()
    await captureEvidence(mantaPage, 'child-toggle-folder-pass-through.png')
  })

  test('pinned duplicates share the chip state and record the sidebar anchor', async ({
    mantaPage
  }) => {
    const { parentId, childId } = await seedLineageScenario(mantaPage)
    await setToggleBinding(mantaPage, ['Mod+Alt+H'])
    await mantaPage.evaluate(async (parentId) => {
      await window.__store?.getState().updateSettings({ showPinnedWorktreesInGroups: true })
      window.__store?.setState((state) => ({
        worktreesByRepo: Object.fromEntries(
          Object.entries(state.worktreesByRepo).map(([repoId, rows]) => [
            repoId,
            rows.map((row) => (row.id === parentId ? { ...row, isPinned: true } : row))
          ])
        )
      }))
      const sidebar = document.querySelector<HTMLElement>('[data-worktree-sidebar]')
      sidebar?.addEventListener('manta-record-virtualized-scroll-anchor', () => {
        sidebar.dataset.anchorRecords = String(Number(sidebar.dataset.anchorRecords ?? 0) + 1)
      })
    }, parentId)
    const chips = mantaPage.getByRole('button', { name: 'Hide 1 child workspace', exact: true })
    await expect(chips).toHaveCount(2)
    const natural = mantaPage
      .locator('[data-worktree-section-key="all"]')
      .filter({ has: chips })
      .first()
    await natural.hover()
    await mantaPage.keyboard.press(CHORD)
    await expect(
      mantaPage.getByRole('button', { name: 'Show 1 child workspace', exact: true })
    ).toHaveCount(2)
    await expect(mantaPage.locator('[data-worktree-sidebar]')).toHaveAttribute(
      'data-anchor-records',
      '1'
    )
    await expect(sidebarWorktreeRow(mantaPage, childId)).toBeHidden()
    await mantaPage
      .getByRole('button', { name: 'Show 1 child workspace', exact: true })
      .first()
      .click()
    await expect(chips).toHaveCount(2)
    await expect(mantaPage.locator('[data-worktree-sidebar]')).toHaveAttribute(
      'data-anchor-records',
      '2'
    )
    await captureEvidence(mantaPage, 'child-toggle-pinned-chip-parity.png')
  })

  test('does nothing while a sidebar filter hides every child', async ({ mantaPage }) => {
    const { parentId, childId } = await seedLineageScenario(mantaPage)
    await setToggleBinding(mantaPage, ['Mod+Alt+H'])
    await seedWorkspaceLiveTerminal(mantaPage, parentId)
    const parentRow = sidebarWorktreeRow(mantaPage, parentId)
    const childRow = sidebarWorktreeRow(mantaPage, childId)
    await parentRow.click()
    await expect(parentRow).toHaveAttribute('aria-current', 'page')

    const readCollapsedGroups = (): Promise<string[]> =>
      mantaPage.evaluate(() => [...(window.__store?.getState().collapsedGroups ?? [])].sort())
    const setShowSleeping = (show: boolean): Promise<void> =>
      mantaPage.evaluate((show) => window.__store?.getState().setShowSleepingWorkspaces(show), show)

    // The child has no live terminal, so hiding sleeping workspaces removes it and its chip.
    await setShowSleeping(false)
    try {
      await expect(childRow).toBeHidden()
      await expect(parentRow.getByRole('button', { name: /child workspace/ })).toHaveCount(0)
      const before = await readCollapsedGroups()

      // Checked after each press: two toggles of one key would cancel out.
      await movePointerOffSidebar(mantaPage)
      await mantaPage.keyboard.press(CHORD)
      expect(await readCollapsedGroups()).toEqual(before)
      await parentRow.hover()
      await mantaPage.keyboard.press(CHORD)
      expect(await readCollapsedGroups()).toEqual(before)
    } finally {
      await setShowSleeping(true)
    }
    await expect(childRow).toBeVisible()
  })
})

test('child-workspace shortcut and chip collapse survive an app restart', async ({
  testRepoPath
}, testInfo) => {
  const session = createRestartSession(testInfo)
  let app: Awaited<ReturnType<typeof session.launch>>['app'] | undefined
  try {
    const first = await session.launch()
    app = first.app
    await attachRepoAndOpenTerminal(first.page, testRepoPath)
    await waitForLineageWorktrees(first.page)
    const family = await seedLineageScenario(first.page)
    await setToggleBinding(first.page, ['Mod+Alt+H'])
    await sidebarWorktreeRow(first.page, family.parentId).click()
    await movePointerOffSidebar(first.page)
    await first.page.keyboard.press(CHORD)
    await expect(sidebarWorktreeRow(first.page, family.childId)).toBeHidden()
    await session.close(app)
    app = undefined

    const second = await session.launch()
    app = second.app
    await attachRepoAndOpenTerminal(second.page, testRepoPath)
    await waitForLineageWorktrees(second.page)
    // Resetting the grouping mode also clears the persisted collapsed groups.
    await seedLineageScenario(second.page, { preserveGrouping: true })
    await expect(
      sidebarWorktreeRow(second.page, family.parentId).getByRole('button', {
        name: 'Show 1 child workspace'
      })
    ).toBeVisible()
    await expect(sidebarWorktreeRow(second.page, family.childId)).toBeHidden()
    await movePointerOffSidebar(second.page)
    await second.page.keyboard.press(CHORD)
    await expect(sidebarWorktreeRow(second.page, family.childId)).toBeVisible()
    await captureEvidence(second.page, 'child-toggle-restart-persistence.png')
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
  }
})
