import { test, expect } from './helpers/manta-app'
import {
  ensureTerminalVisible,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

test('Cmd+J focuses the terminal after waking a sleeping workspace', async ({
  mantaPage
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  const source = await waitForActiveWorktree(mantaPage)
  const target = (await getAllWorktreeIds(mantaPage)).find((id) => id !== source)
  if (!target) {
    throw new Error('Expected a second seeded workspace')
  }
  await switchToWorktree(mantaPage, target)
  await ensureTerminalVisible(mantaPage)
  await waitForActiveTerminalManager(mantaPage)
  await waitForActivePanePtyId(mantaPage)
  const targetName = await mantaPage.evaluate((id) => {
    const state = window.__store!.getState()
    const worktree = state.getKnownWorktreeById(id)
    if (!worktree) {
      throw new Error('Missing target workspace')
    }
    return worktree.branch.replace(/^refs\/heads\//, '')
  }, target)
  await switchToWorktree(mantaPage, source)
  await mantaPage.evaluate(async (id) => {
    await window.__store!.getState().shutdownWorktreeTerminals(id, { keepIdentifiers: true })
  }, target)
  await mantaPage.evaluate(() => {
    const listSessions = window.api.pty.listSessions
    window.api.pty.listSessions = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return listSessions(...args)
    }
  })
  // Native menu accelerators require OS focus; open the same palette in the hidden renderer.
  await mantaPage.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  const dialog = mantaPage.getByRole('dialog', { name: 'Jump to...' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill(targetName)
  await expect(dialog.locator('[cmdk-item][data-selected="true"]')).toContainText(targetName)
  const cdp = await mantaPage.context().newCDPSession(mantaPage)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await mantaPage.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await waitForActiveTerminalManager(mantaPage)
  await waitForActivePanePtyId(mantaPage)
  const terminal = mantaPage
    .locator('[data-terminal-tab-id]:visible .xterm-helper-textarea')
    .first()
  await mantaPage.screenshot({ path: testInfo.outputPath('wake-focus.png') })
  await expect(terminal).toBeFocused()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()
  await mantaPage.keyboard.type('echo WAKE_KEYBOARD_OK')
  await mantaPage.keyboard.press('Enter')
  await waitForTerminalOutput(mantaPage, 'WAKE_KEYBOARD_OK')
  await mantaPage.screenshot({ path: testInfo.outputPath('wake-typing.png') })
})
