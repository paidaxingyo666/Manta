import { expect, test } from './helpers/manta-app'
import type { Page } from '@stablyai/playwright-test'
import { focusActiveTerminalInput } from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  createBrowserSplit,
  createTerminalBrowserSplit,
  focusBrowserAddressBar,
  focusBrowserGroup,
  guestModifier,
  pressKeyInBrowserGuest,
  shortcutModifier as modifier,
  waitForFocusedGroup
} from './helpers/browser-split-fixture'

function browserFindInput(page: Page) {
  return page.getByPlaceholder('Find in page...')
}

function browserFindCloseButton(page: Page) {
  return browserFindInput(page).locator('xpath=..').getByTitle('Close')
}

function browserSplitFindInput(page: Page, browserTabId: string) {
  return page
    .locator(`[data-browser-overlay-tab-id="${browserTabId}"]`)
    .getByPlaceholder('Find in page...')
}

async function pressFindInBrowserGuest(
  page: Page,
  browserTabId: string,
  browserPageId: string
): Promise<void> {
  await pressKeyInBrowserGuest(page, browserTabId, browserPageId, 'F', [guestModifier])
}

function terminalFindInput(page: Page) {
  return page.locator('[data-terminal-search-root] input:visible')
}

test.describe('browser split shortcuts', () => {
  test.beforeEach(async ({ mantaPage }) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
    await ensureTerminalVisible(mantaPage)
  })

  test('routes repeated Find shortcuts to the focused terminal or browser split', async ({
    mantaPage
  }) => {
    const fixture = await createTerminalBrowserSplit(mantaPage)

    await mantaPage.evaluate(({ terminalGroupId }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (state && worktreeId) {
        state.focusGroup(worktreeId, terminalGroupId)
      }
    }, fixture)
    await focusActiveTerminalInput(mantaPage)
    await waitForFocusedGroup(mantaPage, fixture.terminalGroupId)
    await mantaPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(mantaPage)).toBeFocused()
    await expect(browserFindInput(mantaPage)).toBeHidden()
    await mantaPage.keyboard.press('Escape')

    await focusBrowserGroup(mantaPage, fixture.browserGroupId)
    await focusBrowserAddressBar(mantaPage, fixture.browserTabId)
    await mantaPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(mantaPage)).toBeFocused()
    await expect(terminalFindInput(mantaPage)).toBeHidden()
    await browserFindCloseButton(mantaPage).click()
    await expect(browserFindInput(mantaPage)).toBeHidden()

    await mantaPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(mantaPage)).toBeFocused()
    await browserFindCloseButton(mantaPage).click()

    await mantaPage.evaluate(({ browserTabId }) => {
      window.__store?.getState().closeBrowserTab(browserTabId)
    }, fixture)
    await expect(
      mantaPage.locator(`[data-browser-overlay-tab-id="${fixture.browserTabId}"]`)
    ).toHaveCount(0)

    await focusActiveTerminalInput(mantaPage)
    await mantaPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(mantaPage)).toBeFocused()
    await expect(browserFindInput(mantaPage)).toBeHidden()
  })

  test('opens Find only in the browser split whose guest owns the shortcut', async ({
    mantaPage
  }) => {
    const fixture = await createBrowserSplit(mantaPage)

    await pressFindInBrowserGuest(mantaPage, fixture.firstBrowserTabId, fixture.firstBrowserPageId)

    await expect(browserSplitFindInput(mantaPage, fixture.firstBrowserTabId)).toBeVisible()
    await expect(browserSplitFindInput(mantaPage, fixture.secondBrowserTabId)).toBeHidden()
    await expect
      .poll(() =>
        mantaPage.evaluate(
          ({ browserPageId, browserTabId }) =>
            window.__store
              ?.getState()
              .browserPagesByWorkspace[browserTabId]?.find((page) => page.id === browserPageId)
              ?.loadError?.code ?? null,
          {
            browserPageId: fixture.firstBrowserPageId,
            browserTabId: fixture.firstBrowserTabId
          }
        )
      )
      .toBeNull()
  })

  test('keeps browser Find available when split focus state is temporarily missing', async ({
    mantaPage
  }) => {
    const fixture = await createTerminalBrowserSplit(mantaPage)
    await focusBrowserGroup(mantaPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(mantaPage, fixture.browserTabId)
    await focusBrowserAddressBar(mantaPage, fixture.browserTabId)

    await mantaPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => {
        const activeGroupIdByWorktree = { ...state.activeGroupIdByWorktree }
        delete activeGroupIdByWorktree[worktreeId]
        return { activeGroupIdByWorktree }
      })
    })
    await expect(addressBar).toBeFocused()

    await mantaPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(mantaPage)).toBeFocused()
    await expect(terminalFindInput(mantaPage)).toBeHidden()
  })

  test('keeps browser Find available when the focused split ID is stale', async ({ mantaPage }) => {
    const fixture = await createTerminalBrowserSplit(mantaPage)
    await focusBrowserGroup(mantaPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(mantaPage, fixture.browserTabId)
    await focusBrowserAddressBar(mantaPage, fixture.browserTabId)

    await mantaPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => ({
        activeGroupIdByWorktree: {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: 'removed-group'
        }
      }))
    })
    await expect(addressBar).toBeFocused()

    await mantaPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(mantaPage)).toBeFocused()
    await expect(terminalFindInput(mantaPage)).toBeHidden()
  })
})
