// STA-8147 follow-up: the floating browser and a focused split browser each answer only the
// chrome chords pressed inside them.

import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/manta-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  browserOverlay,
  createTerminalBrowserSplit,
  focusBrowserGroup,
  pressKeyInBrowserGuest,
  shortcutModifier
} from './helpers/browser-split-fixture'
import {
  guestLoadStarts,
  navigateGuest,
  recordGuestLoadStarts,
  waitForGuestIdle,
  waitForGuestUrl
} from './helpers/browser-split-guest-probes'
import { startBrowserSplitPageServer } from './helpers/browser-split-page-server'

// Why: mirrors FLOATING_TERMINAL_WORKTREE_ID in src/shared/constants.ts.
const FLOATING_WORKTREE_ID = 'global-floating-terminal'
const FLOATING_PANEL = '[data-floating-terminal-panel]'
const isMac = process.platform === 'darwin'
const backChord = isMac ? 'Meta+BracketLeft' : 'Alt+ArrowLeft'
const forwardChord = isMac ? 'Meta+BracketRight' : 'Alt+ArrowRight'

async function openFloatingBrowser(
  page: Page,
  url: string
): Promise<{ browserTabId: string; browserPageId: string }> {
  const floating = await page.evaluate(
    ({ worktreeId, initialUrl }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      store.setState({ settings: { ...store.getState().settings, floatingTerminalEnabled: true } })
      const state = store.getState()
      const tab = state.createBrowserTab(worktreeId, initialUrl, {
        activate: true,
        focusAddressBar: false,
        targetGroupId: state.ensureWorktreeRootGroup(worktreeId),
        browserRuntimeEnvironmentId: null
      })
      if (!tab.activePageId) {
        throw new Error('Floating browser page unavailable')
      }
      return { browserTabId: tab.id, browserPageId: tab.activePageId }
    },
    { worktreeId: FLOATING_WORKTREE_ID, initialUrl: url }
  )
  // Why: the toggle listener closes over floatingTerminalEnabled, so wait for the panel to mount.
  await expect(page.locator(FLOATING_PANEL)).toHaveCount(1)
  const openPanel = page.locator(`${FLOATING_PANEL}[aria-hidden="false"]`)
  if ((await openPanel.count()) === 0) {
    await page.evaluate(() => window.dispatchEvent(new Event('manta-toggle-floating-terminal')))
  }
  await expect(
    openPanel.locator(`[data-browser-overlay-tab-id="${floating.browserTabId}"]`)
  ).toBeVisible()
  return floating
}

function findInput(page: Page, browserTabId: string) {
  return browserOverlay(page, browserTabId).getByPlaceholder('Find in page...')
}

function grabButton(page: Page, browserTabId: string) {
  return browserOverlay(page, browserTabId).getByRole('button', {
    name: 'Grab page element',
    exact: true
  })
}

// Why: a non-editable chrome target, so reload and grab are not skipped as text-field keys.
async function focusChrome(page: Page, browserTabId: string): Promise<void> {
  const target = grabButton(page, browserTabId)
  await expect(target).toBeEnabled()
  await target.focus()
  await expect(target).toBeFocused()
}

test.describe('floating browser shortcut scope', () => {
  test.beforeEach(async ({ mantaPage }) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
    await ensureTerminalVisible(mantaPage)
  })

  test('chrome shortcuts act only in the pane that owns the key press', async ({ mantaPage }) => {
    const server = await startBrowserSplitPageServer()
    try {
      const split = await createTerminalBrowserSplit(mantaPage, server.pageUrl('split', 1))
      const floating = await openFloatingBrowser(mantaPage, server.pageUrl('float', 1))
      await focusBrowserGroup(mantaPage, split.browserGroupId)
      await waitForGuestUrl(mantaPage, split.browserTabId, server.pageUrl('split', 1))
      await waitForGuestUrl(mantaPage, floating.browserTabId, server.pageUrl('float', 1))
      await navigateGuest(mantaPage, split.browserTabId, server.pageUrl('split', 2))
      await navigateGuest(mantaPage, floating.browserTabId, server.pageUrl('float', 2))

      const cases = [
        {
          name: 'float',
          owner: floating.browserTabId,
          other: split.browserTabId,
          otherName: 'split'
        },
        {
          name: 'split',
          owner: split.browserTabId,
          other: floating.browserTabId,
          otherName: 'float'
        }
      ]
      for (const { name, owner, other, otherName } of cases) {
        await test.step(`keys pressed in the ${name} browser chrome`, async () => {
          await focusChrome(mantaPage, owner)
          await mantaPage.keyboard.press(backChord)
          await waitForGuestUrl(mantaPage, owner, server.pageUrl(name, 1))
          await waitForGuestIdle(mantaPage, other)
          await waitForGuestUrl(mantaPage, other, server.pageUrl(otherName, 2))
          await focusChrome(mantaPage, owner)
          await mantaPage.keyboard.press(forwardChord)
          await waitForGuestUrl(mantaPage, owner, server.pageUrl(name, 2))
          await waitForGuestUrl(mantaPage, other, server.pageUrl(otherName, 2))

          await recordGuestLoadStarts(mantaPage, [owner, other])
          await focusChrome(mantaPage, owner)
          await mantaPage.keyboard.press(`${shortcutModifier}+r`)
          await expect.poll(() => guestLoadStarts(mantaPage, owner)).toBeGreaterThan(0)
          await waitForGuestIdle(mantaPage, owner)
          expect(await guestLoadStarts(mantaPage, other)).toBe(0)

          await focusChrome(mantaPage, owner)
          await mantaPage.keyboard.press(`${shortcutModifier}+f`)
          await expect(findInput(mantaPage, owner)).toBeFocused()
          await expect(findInput(mantaPage, other)).toBeHidden()
          await mantaPage.keyboard.press('Escape')
          await expect(findInput(mantaPage, owner)).toBeHidden()

          await focusChrome(mantaPage, owner)
          await mantaPage.keyboard.press(`${shortcutModifier}+l`)
          await expect(browserAddressBar(mantaPage, owner)).toBeFocused()

          await focusChrome(mantaPage, owner)
          await mantaPage.keyboard.press(`${shortcutModifier}+c`)
          await expect(grabButton(mantaPage, owner)).toHaveAttribute('data-variant', 'default')
          await expect(grabButton(mantaPage, other)).toHaveAttribute('data-variant', 'ghost')
          await grabButton(mantaPage, owner).click()
          await expect(grabButton(mantaPage, owner)).toHaveAttribute('data-variant', 'ghost')
        })
      }

      await test.step('back pressed inside the floating page', async () => {
        await pressKeyInBrowserGuest(
          mantaPage,
          floating.browserTabId,
          floating.browserPageId,
          isMac ? '[' : 'Left',
          [isMac ? 'meta' : 'alt']
        )
        await waitForGuestUrl(mantaPage, floating.browserTabId, server.pageUrl('float', 1))
        await waitForGuestUrl(mantaPage, split.browserTabId, server.pageUrl('split', 2))
      })
    } finally {
      await server.close()
    }
  })
})
