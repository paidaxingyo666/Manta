import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/manta-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })
test.skip(process.platform !== 'win32', 'A real Windows ConPTY is required')

async function getKittyKeyboardFlags(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const pane = tabId ? window.__paneManagers?.get(tabId)?.getActivePane?.() : null
    const terminal = pane?.terminal as
      | {
          core?: { coreService?: { kittyKeyboard?: { flags?: number } } }
          _core?: { coreService?: { kittyKeyboard?: { flags?: number } } }
        }
      | undefined
    return (
      terminal?.core?.coreService?.kittyKeyboard?.flags ??
      terminal?._core?.coreService?.kittyKeyboard?.flags ??
      null
    )
  })
}

test('resets standard keyboard bytes after a protocol-mode agent exits on ConPTY', async ({
  electronApp,
  mantaPage
}) => {
  await installTerminalPtyWriteSpy(electronApp)
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await configureGoldenStubAgent(mantaPage, { agentArgs: '--keyboard-protocol' })
  await launchGoldenStubAgentFromNewTab(mantaPage)

  const ptyId = await waitForActivePanePtyId(mantaPage)
  await expect.poll(() => getKittyKeyboardFlags(mantaPage), { timeout: 10_000 }).toBe(1)

  await clearTerminalPtyWriteLog(electronApp)
  await mantaPage.keyboard.type('exit')
  await mantaPage.keyboard.press('Enter')
  await waitForTerminalOutput(mantaPage, GOLDEN_STUB_EXIT_MARKER, 15_000)
  const protocolWrites = (await readTerminalPtyWriteEntries(electronApp))
    .filter((entry) => entry.id === ptyId)
    .map((entry) => entry.data)
    .join('')
  expect(protocolWrites.includes('\x1b[13u') || protocolWrites.includes('\x1b[13;1u')).toBe(true)
  await expect.poll(() => getKittyKeyboardFlags(mantaPage), { timeout: 10_000 }).toBe(0)

  await clearTerminalPtyWriteLog(electronApp)
  await focusActiveTerminalInput(mantaPage)
  await mantaPage.keyboard.type("Write-Output ('CONPTY_KEYBOARD_' + '")
  await mantaPage.evaluate((text) => window.api.ui.writeClipboardText(text), 'REET_')
  await mantaPage.keyboard.press('Control+V')
  await mantaPage.keyboard.press('ArrowLeft')
  await mantaPage.keyboard.press('ArrowLeft')
  await mantaPage.keyboard.press('ArrowLeft')
  await mantaPage.keyboard.type('S')
  await mantaPage.keyboard.press('ArrowRight')
  await mantaPage.keyboard.press('ArrowRight')
  await mantaPage.keyboard.press('ArrowRight')
  await mantaPage.keyboard.type('EXECUTEX')
  await mantaPage.keyboard.press('Backspace')
  await mantaPage.keyboard.type("D')")
  await mantaPage.keyboard.press('Enter')
  await waitForTerminalOutput(mantaPage, 'CONPTY_KEYBOARD_RESET_EXECUTED', 15_000)

  const shellWrites = (await readTerminalPtyWriteEntries(electronApp))
    .filter((entry) => entry.id === ptyId)
    .map((entry) => entry.data)
  const joinedShellWrites = shellWrites.join('')
  expect(joinedShellWrites).toContain('REET_')
  expect(shellWrites.filter((data) => data === '\x1b[D')).toHaveLength(3)
  expect(shellWrites.filter((data) => data === '\x1b[C')).toHaveLength(3)
  expect(shellWrites).toContain('\x7f')
  expect(shellWrites).toContain('\r')
  expect(joinedShellWrites).not.toMatch(new RegExp(`${String.fromCharCode(27)}\\[\\d+(?:;\\d+)*u`))
})
