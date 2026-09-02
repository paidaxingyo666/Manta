/**
 * E2E tests for editing a pane title through Set Title: opening the editor,
 * committing it, and keeping it pane-local while tab titles churn.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/manta-app'
import { splitActiveTerminalPane, waitForPaneCount } from './helpers/terminal'
import { getActiveWorktreeId, getActiveTabId, getWorktreeTabs } from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import {
  setPaneTitleFromTerminalMenu,
  openTerminalContextMenu
} from './helpers/terminal-pane-title-actions'
import {
  readVisibleXtermContainerBox,
  expectTerminalToReserveTitleSpace
} from './helpers/terminal-pane-geometry'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

async function openPaneTitleContextMenu(page: Page, title: string): Promise<void> {
  const modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[] = (await page.evaluate(() =>
    navigator.userAgent.includes('Windows')
  ))
    ? ['Control']
    : []
  const isMac = await page.evaluate(() => navigator.userAgent.includes('Mac'))
  const titleBar = page.locator('.pane-title-bar', { hasText: title }).first()
  await expect(titleBar).toBeVisible()
  await titleBar.click({
    button: isMac ? 'left' : 'right',
    position: { x: 20, y: 10 },
    modifiers: isMac ? ['Control'] : modifiers
  })
  await expect(page.getByText('Set Title…', { exact: true })).toBeVisible()
}

async function getTabCustomTitle(
  page: Page,
  worktreeId: string,
  tabId: string
): Promise<string | null> {
  return page.evaluate(
    ({ targetWorktreeId, targetTabId }) => {
      const state = window.__store!.getState()
      const tab = (state.tabsByWorktree[targetWorktreeId] ?? []).find(
        (entry) => entry.id === targetTabId
      )
      return tab?.customTitle ?? null
    },
    { targetWorktreeId: worktreeId, targetTabId: tabId }
  )
}

async function expectTabCustomTitle(
  page: Page,
  worktreeId: string,
  tabId: string,
  expected: string | null
): Promise<void> {
  await expect
    .poll(() => getTabCustomTitle(page, worktreeId, tabId), { timeout: 3_000 })
    .toBe(expected)
}

async function expectSavedLayoutNotToContainTitle(
  page: Page,
  tabId: string,
  title: string
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ targetTabId, title }) => {
            const layout = window.__store!.getState().terminalLayoutsByTabId[targetTabId]
            return Object.values(layout?.titlesByLeafId ?? {}).includes(title)
          },
          { targetTabId: tabId, title }
        ),
      { timeout: 3_000 }
    )
    .toBe(false)
}

// Why: keep the suite serial so the headful pane tests never ask Playwright to
// open multiple visible Electron windows at once.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('first Set Title from terminal context menu stays open for typing', async ({
    mantaPage
  }) => {
    const title = `First menu title ${Date.now()}`

    await openTerminalContextMenu(mantaPage)
    await mantaPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = mantaPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await mantaPage.waitForTimeout(250)
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()

    await titleInput.fill(title)
    await titleInput.press('Enter')

    await expect(titleInput).toHaveCount(0)
    await expect(mantaPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title editor renders in Manta overlay while terminal reserves title space', async ({
    mantaPage
  }) => {
    const title = `Reserved overlay title ${Date.now()}`
    const terminalBoxBefore = await readVisibleXtermContainerBox(mantaPage)

    await openTerminalContextMenu(mantaPage)
    await mantaPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = mantaPage.locator('.pane-title-overlay-layer .pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await expect(mantaPage.getByText('Set Title…', { exact: true })).toBeHidden()
    await expect(mantaPage.locator('.pane .pane-title-input')).toHaveCount(0)
    await expect(mantaPage.locator('.pane[data-has-title]')).toHaveCount(1)
    await expect
      .poll(() =>
        mantaPage
          .locator('.pane-title-bar')
          .first()
          .evaluate((titleBar) => getComputedStyle(titleBar).backgroundColor)
      )
      .not.toBe('rgba(0, 0, 0, 0)')
    const terminalBoxEditing = await readVisibleXtermContainerBox(mantaPage)
    expectTerminalToReserveTitleSpace(terminalBoxEditing, terminalBoxBefore)

    await titleInput.fill(title)
    await titleInput.press('Enter')
    await expect(mantaPage.locator('.pane-title-text', { hasText: title })).toBeVisible()
    await expect(mantaPage.locator('.pane[data-has-title]')).toHaveCount(1)
    expectTerminalToReserveTitleSpace(
      await readVisibleXtermContainerBox(mantaPage),
      terminalBoxBefore
    )
  })

  test('Set Title context menu opens from the title overlay strip', async ({ mantaPage }) => {
    const title = `Overlay menu title ${Date.now()}`
    const updatedTitle = `Overlay menu updated ${Date.now()}`

    await setPaneTitleFromTerminalMenu(mantaPage, title)
    await openPaneTitleContextMenu(mantaPage, title)
    await mantaPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = mantaPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await expect(titleInput).toHaveValue(title)
    await titleInput.fill(updatedTitle)
    await titleInput.press('Enter')

    await expect(mantaPage.locator('.pane-title-text', { hasText: updatedTitle })).toHaveCount(1)
    await expect(mantaPage.locator('.pane-title-text', { hasText: title })).toHaveCount(0)
  })

  test('Set Title commits when tabbing away from the title input', async ({ mantaPage }) => {
    const title = `Tab commit title ${Date.now()}`

    await openTerminalContextMenu(mantaPage)
    await mantaPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = mantaPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await titleInput.fill(title)
    await titleInput.press('Tab')

    await expect(titleInput).toHaveCount(0)
    await expect(mantaPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title overlay hides with its inactive terminal tab', async ({ mantaPage }) => {
    const title = `Hidden tab title ${Date.now()}`
    const worktreeId = (await getActiveWorktreeId(mantaPage))!

    await setPaneTitleFromTerminalMenu(mantaPage, title)
    await expect(mantaPage.locator('.pane-title-text', { hasText: title })).toBeVisible()

    await pressShortcut(mantaPage, 't')
    await expect
      .poll(async () => (await getWorktreeTabs(mantaPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)
    await expect(mantaPage.locator('.pane-title-text', { hasText: title })).toBeHidden()

    await pressShortcut(mantaPage, 'BracketLeft', { shift: true })
    await expect(mantaPage.locator('.pane-title-text', { hasText: title })).toBeVisible()
  })

  test('Set Title still commits by blur after focus settles', async ({ mantaPage }) => {
    const title = `Blur commit title ${Date.now()}`

    await openTerminalContextMenu(mantaPage)
    await mantaPage.getByText('Set Title…', { exact: true }).click()

    const titleInput = mantaPage.locator('.pane-title-input').first()
    await expect(titleInput).toBeVisible()
    await expect(titleInput).toBeFocused()
    await mantaPage.waitForTimeout(100)
    await titleInput.fill(title)
    await mantaPage
      .locator('.xterm:visible')
      .first()
      .click({ position: { x: 40, y: 60 } })

    await expect(titleInput).toHaveCount(0)
    await expect(mantaPage.locator('.pane-title-text', { hasText: title })).toHaveCount(1)
  })

  test('Set Title stays pane-local during agent title churn', async ({ mantaPage }) => {
    const worktreeId = (await getActiveWorktreeId(mantaPage))!
    const tabId = (await getActiveTabId(mantaPage))!
    const paneTitle = `Codex pane ${Date.now()}`
    const removeButtonTitle = `Remove button label ${Date.now()}`
    const splitTitle = `Split label ${Date.now()}`
    const runtimeTitle = '⠋ Codex working'

    await setPaneTitleFromTerminalMenu(mantaPage, paneTitle)
    await expect(mantaPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()
    await expectTabCustomTitle(mantaPage, worktreeId, tabId, null)

    await mantaPage.getByRole('button', { name: `Edit pane title: ${paneTitle}` }).focus()
    await mantaPage.keyboard.press('Enter')
    const paneTitleInput = mantaPage.getByRole('textbox', { name: 'Pane title' })
    await expect(paneTitleInput).toBeVisible()
    await expect(paneTitleInput).toBeFocused()
    await mantaPage.keyboard.press('Escape')
    await expect(paneTitleInput).toHaveCount(0)
    await expect(mantaPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()

    await mantaPage.evaluate(
      ({ targetTabId, title }) => {
        window.__store!.getState().updateTabTitle(targetTabId, title)
      },
      { targetTabId: tabId, title: runtimeTitle }
    )

    // Why: active agents continuously write OSC titles. Set Title is Manta's
    // pane-local overlay and must remain visible while the tab runtime title
    // continues to follow the active PTY.
    await expect(mantaPage.locator('.pane-title-text', { hasText: paneTitle })).toBeVisible()
    await expect(
      mantaPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    ).toHaveAttribute('data-tab-title', runtimeTitle)
    await expectTabCustomTitle(mantaPage, worktreeId, tabId, null)

    await setPaneTitleFromTerminalMenu(mantaPage, '')
    await expect(mantaPage.locator('.pane-title-text', { hasText: paneTitle })).toBeHidden()
    await expectSavedLayoutNotToContainTitle(mantaPage, tabId, paneTitle)

    await setPaneTitleFromTerminalMenu(mantaPage, removeButtonTitle)
    await setPaneTitleFromTerminalMenu(mantaPage, '')
    await expect(mantaPage.locator('.pane-title-text', { hasText: removeButtonTitle })).toBeHidden()
    await expectSavedLayoutNotToContainTitle(mantaPage, tabId, removeButtonTitle)

    await setPaneTitleFromTerminalMenu(mantaPage, splitTitle)
    await expectTabCustomTitle(mantaPage, worktreeId, tabId, null)

    await splitActiveTerminalPane(mantaPage, 'vertical')
    await waitForPaneCount(mantaPage, 2)
    await expect(mantaPage.locator('.pane-title-text', { hasText: splitTitle })).toBeVisible()

    await mantaPage.evaluate(
      ({ targetTabId, title }) => {
        window.__store!.getState().updateTabTitle(targetTabId, title)
      },
      { targetTabId: tabId, title: runtimeTitle }
    )
    await expect(
      mantaPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    ).toHaveAttribute('data-tab-title', runtimeTitle)
  })
})
