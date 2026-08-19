import { test, expect } from './helpers/manta-app'
import { getStoreState, waitForSessionReady } from './helpers/store'
import type { ElectronApplication } from '@stablyai/playwright-test'

async function openFeatureTourFromMenu(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const featureTourItem = Menu.getApplicationMenu()
      ?.items.find((item) => item.label === 'Help')
      ?.submenu?.items.find((item) => item.label === 'Explore Manta')

    if (!featureTourItem) {
      throw new Error('Explore Manta menu item was not registered')
    }

    const window = BrowserWindow.getAllWindows()[0]
    featureTourItem.click(featureTourItem, window, {
      triggeredByAccelerator: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false
    } as Electron.KeyboardEvent)
  })
}

test.describe('Feature tour modal', () => {
  test.beforeEach(async ({ mantaPage }) => {
    await waitForSessionReady(mantaPage)
  })

  test('opens from the Help menu and renders the workflow rail', async ({
    electronApp,
    mantaPage
  }) => {
    await openFeatureTourFromMenu(electronApp)

    await expect(mantaPage.getByRole('dialog', { name: 'Get to know Manta' })).toBeVisible({
      timeout: 10_000
    })
    await expect(mantaPage.getByText('Reopen any time from Help > Explore Manta.')).toBeVisible()

    // Five workflow rows in the rail.
    const rail = mantaPage.getByRole('navigation', { name: 'Workflows' })
    await expect(rail.getByRole('tab')).toHaveCount(5)
    await expect(rail.getByRole('tab', { name: /Workspaces/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await expect(mantaPage.locator('[data-ws-id]')).toHaveCount(3)

    // ArrowDown moves selection through the rail.
    await rail.getByRole('tab', { name: /Workspaces/i }).focus()
    await mantaPage.keyboard.press('ArrowDown')
    await expect(rail.getByRole('tab', { name: /Tasks/i })).toHaveAttribute('aria-selected', 'true')
    await mantaPage.keyboard.press('ArrowDown')
    await expect(rail.getByRole('tab', { name: /Agents/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await rail.getByRole('tab', { name: /Workbench/i }).click()
    await rail.getByRole('button', { name: /Browser/i }).click()
    await expect(
      mantaPage.getByText(
        "Run your app in Manta's browser, send selected UI elements to agents, and let your agents interact with your webpage."
      )
    ).toBeVisible()
    await expect(mantaPage.getByRole('heading', { name: 'Browser Use skill' })).toBeVisible()
    await expect(
      mantaPage.getByText("Enables agents to navigate and verify pages in Manta's browser.")
    ).toBeVisible()
    await expect(mantaPage.getByRole('heading', { name: 'CLI skill' })).toHaveCount(0)
    await expect(mantaPage.getByText('With the Manta CLI skill', { exact: false })).toHaveCount(0)
  })

  test('shows unified task copy without leaving the walkthrough', async ({ mantaPage }) => {
    await mantaPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.setState({
        preflightStatus: {
          git: { installed: true },
          gh: { installed: true, authenticated: false },
          glab: { installed: false, authenticated: false },
          bitbucket: { configured: false, authenticated: false, account: null },
          azureDevOps: {
            configured: false,
            authenticated: false,
            account: null,
            baseUrl: null,
            tokenConfigured: false
          },
          gitea: {
            configured: false,
            authenticated: false,
            account: null,
            baseUrl: null,
            tokenConfigured: false
          }
        },
        preflightStatusChecked: true,
        preflightStatusLoading: false,
        linearStatus: { connected: false, viewer: null },
        linearStatusChecked: true
      })
      store.getState().openModal('feature-wall', { source: 'help_menu' })
    })

    await expect(mantaPage.getByRole('dialog', { name: 'Get to know Manta' })).toBeVisible({
      timeout: 10_000
    })
    await mantaPage
      .getByRole('navigation', { name: 'Workflows' })
      .getByRole('tab', { name: /Tasks/i })
      .click()
    await expect(mantaPage.getByText('Start work directly from GitHub or Linear.')).toBeVisible()
    await expect(mantaPage.getByText('Connect GitHub or Linear once')).toHaveCount(0)
    await expect(mantaPage.getByRole('dialog', { name: 'Get to know Manta' })).toBeVisible()
    await expect
      .poll(async () => getStoreState<string>(mantaPage, 'activeView'))
      .not.toBe('settings')
  })

  test('continue advances through workflow substeps before the next workflow', async ({
    mantaPage
  }) => {
    await mantaPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().openModal('feature-wall', { source: 'help_menu' })
    })

    const rail = mantaPage.getByRole('navigation', { name: 'Workflows' })
    const continueButton = mantaPage.getByRole('button', { name: /^Continue/ })

    await continueButton.click()
    await expect(rail.getByRole('tab', { name: /Tasks/i })).toHaveAttribute('aria-selected', 'true')

    await continueButton.click()
    await expect(rail.getByRole('tab', { name: /Agents/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(rail.getByRole('button', { name: /Visibility/i })).toHaveAttribute(
      'aria-current',
      'step'
    )

    await continueButton.click()
    await expect(rail.getByRole('button', { name: /Orchestration/i })).toHaveAttribute(
      'aria-current',
      'step'
    )
    await expect(rail.getByRole('tab', { name: /Workbench/i })).toHaveAttribute(
      'aria-selected',
      'false'
    )

    await continueButton.click()
    await expect(rail.getByRole('button', { name: /Usage/i })).toHaveAttribute(
      'aria-current',
      'step'
    )

    await continueButton.click()
    await expect(rail.getByRole('tab', { name: /Workbench/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(rail.getByRole('button', { name: /Terminal/i })).toHaveAttribute(
      'aria-current',
      'step'
    )
  })

  test('does not pre-check configured workflows until the user visits them', async ({
    mantaPage
  }) => {
    await mantaPage.evaluate(() => {
      for (const key of [
        'manta.featureWall.visitedWorkflows.v1',
        'manta.featureWall.visitedAgentSteps.v1',
        'manta.featureWall.visitedWorkbenchSteps.v1',
        'manta.featureWall.visitedReviewSteps.v1',
        'manta.featureWall.completedWorkflows.v1',
        'manta.featureWall.completedAgentSteps.v1',
        'manta.featureWall.completedWorkbenchSteps.v1',
        'manta.featureWall.completedReviewSteps.v1'
      ]) {
        localStorage.removeItem(key)
      }
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.setState({
        preflightStatus: {
          git: { installed: true },
          gh: { installed: true, authenticated: true },
          glab: { installed: false, authenticated: false },
          bitbucket: { configured: false, authenticated: false, account: null },
          azureDevOps: {
            configured: false,
            authenticated: false,
            account: null,
            baseUrl: null,
            tokenConfigured: false
          },
          gitea: {
            configured: false,
            authenticated: false,
            account: null,
            baseUrl: null,
            tokenConfigured: false
          }
        },
        preflightStatusChecked: true,
        preflightStatusLoading: false,
        linearStatus: { connected: false, viewer: null },
        linearStatusChecked: true
      })
      store.getState().openModal('feature-wall', { source: 'help_menu' })
    })

    const rail = mantaPage.getByRole('navigation', { name: 'Workflows' })
    const workspacesTab = rail.locator('[data-feature-wall-workflow-id="workspaces"]')
    const tasksTab = rail.locator('[data-feature-wall-workflow-id="tasks"]')
    await expect(workspacesTab.locator('[aria-label="Completed"]')).toHaveCount(1)
    await expect(tasksTab.locator('[aria-label="Completed"]')).toHaveCount(0)
    await tasksTab.click()
    await expect(tasksTab.locator('[aria-label="Completed"]')).toHaveCount(1)
    await expect(workspacesTab.locator('[aria-label="Completed"]')).toHaveCount(1)
  })

  test('keeps persisted completed setup-backed substeps checked when reopened', async ({
    mantaPage
  }) => {
    await mantaPage.evaluate(() => {
      localStorage.setItem(
        'manta.featureWall.completedAgentSteps.v1',
        JSON.stringify(['orchestration'])
      )
      localStorage.setItem(
        'manta.featureWall.completedWorkbenchSteps.v1',
        JSON.stringify(['browser'])
      )
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().openModal('feature-wall', { source: 'help_menu' })
    })

    const rail = mantaPage.getByRole('navigation', { name: 'Workflows' })

    await rail.getByRole('tab', { name: /Agents/i }).click()
    await expect(
      rail.getByRole('button', { name: /Orchestration/i }).locator('[aria-label="Completed"]')
    ).toHaveCount(1)

    await rail.getByRole('tab', { name: /Workbench/i }).click()
    await expect(
      rail.getByRole('button', { name: /Browser/i }).locator('[aria-label="Completed"]')
    ).toHaveCount(1)
  })
})
