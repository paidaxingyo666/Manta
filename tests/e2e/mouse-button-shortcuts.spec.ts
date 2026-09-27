import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/manta-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

async function pressSideButton(
  page: Page,
  target: Locator,
  button: 'back' | 'forward',
  modifiers = 0
): Promise<void> {
  const bounds = await target.boundingBox()
  if (!bounds) {
    throw new Error('Mouse shortcut target is not rendered')
  }
  const session = await page.context().newCDPSession(page)
  try {
    const event = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      button,
      modifiers,
      clickCount: 1
    }
    await session.send('Input.dispatchMouseEvent', {
      ...event,
      type: 'mousePressed',
      buttons: button === 'back' ? 8 : 16
    })
    await session.send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased', buttons: 0 })
  } finally {
    await session.detach()
  }
}

test('records mouse buttons with modifiers and switches rendered terminal tabs', async ({
  mantaPage
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  await ensureTerminalVisible(mantaPage)
  const tabs = await mantaPage.evaluate(async () => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId || !state.activeTabId) {
      throw new Error('No active terminal')
    }
    const first = state.activeTabId
    const second = state.createTab(state.activeWorktreeId).id
    await state.updateSettings({ uiLanguage: 'en' })
    state.openSettingsPage()
    return { first, second }
  })
  await mantaPage.getByPlaceholder('Search settings').fill('shortcuts')
  const search = mantaPage.getByPlaceholder('Search command or keys')
  await search.fill('Previous tab (same type)')
  await mantaPage
    .getByRole('button', { name: 'Change shortcut for Previous tab (same type)', exact: true })
    .click()
  await pressSideButton(mantaPage, mantaPage.locator('[data-shortcut-recorder-active]'), 'back')
  await mantaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('recorded-mouse-back.png')
  })
  await expect(mantaPage.locator('[data-shortcut-recorder-active]')).toHaveCount(0)
  await expect(mantaPage.locator('[data-shortcut-recorder]')).toContainText('Mouse Back')

  await search.fill('Next tab (same type)')
  await mantaPage
    .getByRole('button', { name: 'Change shortcut for Next tab (same type)', exact: true })
    .click()
  // CDP modifier bit 8 is Shift on every supported platform.
  await pressSideButton(mantaPage, mantaPage.locator('[data-shortcut-recorder-active]'), 'forward', 8)
  await expect(mantaPage.locator('[data-shortcut-recorder-active]')).toHaveCount(0)
  await expect(mantaPage.locator('[data-shortcut-recorder]')).toContainText('Mouse Forward')
  await expect
    .poll(() => mantaPage.evaluate(async () => (await window.api.keybindings.reload()).overrides))
    .toMatchObject({
      'tab.previousSameType': ['MouseBack'],
      'tab.nextSameType': ['Shift+MouseForward']
    })
  await mantaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('recorded-shift-mouse-forward.png')
  })
  await mantaPage.evaluate(() => window.__store?.getState().closeSettingsPage())
  const firstTab = mantaPage.locator(`[data-tab-id="${tabs.first}"]`)
  const secondTab = mantaPage.locator(`[data-tab-id="${tabs.second}"]`)
  await secondTab.click()
  await expect(secondTab).toHaveAttribute('data-active', 'true')
  const terminal = mantaPage.locator(`[data-terminal-tab-id="${tabs.second}"] .xterm-screen`)
  await pressSideButton(mantaPage, terminal, 'back')
  await expect(firstTab).toHaveAttribute('data-active', 'true')
  await expect(secondTab).toHaveAttribute('data-active', 'false')
  await mantaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('mouse-back-terminal.png')
  })
  const firstTerminal = mantaPage.locator(`[data-terminal-tab-id="${tabs.first}"] .xterm-screen`)
  await pressSideButton(mantaPage, firstTerminal, 'forward')
  await expect(firstTab).toHaveAttribute('data-active', 'true')
  await pressSideButton(mantaPage, firstTerminal, 'forward', 8)
  await expect(secondTab).toHaveAttribute('data-active', 'true')
  await expect(firstTab).toHaveAttribute('data-active', 'false')
  await mantaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('shift-mouse-forward-terminal.png')
  })
})

test('opens Settings with a recorded mouse shortcut for a native menu action', async ({
  mantaPage
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await mantaPage.evaluate(async () => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('Store unavailable')
    }
    await state.updateSettings({ uiLanguage: 'en' })
    state.openSettingsPage()
  })
  await mantaPage.getByPlaceholder('Search settings').fill('shortcuts')
  await mantaPage.getByPlaceholder('Search command or keys').fill('Open Settings')
  await mantaPage
    .getByRole('button', { name: 'Add shortcut for Open Settings', exact: true })
    .click()
  await pressSideButton(mantaPage, mantaPage.locator('[data-shortcut-recorder-active]'), 'back')
  await expect(mantaPage.locator('[data-shortcut-recorder-active]')).toHaveCount(0)
  await expect(mantaPage.locator('[data-shortcut-recorder]')).toContainText('Mouse Back')
  await mantaPage.getByRole('button', { name: 'Back to app', exact: true }).click()
  await expect(mantaPage.getByPlaceholder('Search settings')).not.toBeVisible()
  await pressSideButton(
    mantaPage,
    mantaPage.locator('.xterm-screen').filter({ visible: true }),
    'back'
  )
  await expect(mantaPage.getByPlaceholder('Search settings')).toBeVisible()
  await mantaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('mouse-back-opens-settings.png')
  })
})
