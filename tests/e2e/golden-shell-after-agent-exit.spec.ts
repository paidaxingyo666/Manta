import { expect, test } from './helpers/manta-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForRestoredTerminalInputReady } from './helpers/restored-terminal-input-readiness'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

// Why: xterm renders the typed command itself, so `echo after-agent` would
// satisfy waitForTerminalOutput even if the shell never ran it. Splitting the
// marker keeps it out of the input, so a match proves real shell execution.
function buildSplitMarkerEcho(prefix: string, suffix: string): { command: string; marker: string } {
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${prefix}' + '${suffix}')`
      : `echo "${prefix}""${suffix}"`
  return { command, marker: `${prefix}${suffix}` }
}

test('opens a clean live shell after an agent exits', async ({ mantaPage }) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await configureGoldenStubAgent(mantaPage)
  await launchGoldenStubAgentFromNewTab(mantaPage)

  await mantaPage.keyboard.type('exit')
  await mantaPage.keyboard.press('Enter')
  await waitForTerminalOutput(mantaPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await mantaPage.locator('[data-testid="sortable-tab"]').count()
  await mantaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await mantaPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(mantaPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  const shellPtyId = await waitForActivePanePtyId(mantaPage)
  // Why: a bound ptyId only means the pane exists; the renderer transport can
  // still drop keystrokes until it connects, which would strand the markers.
  expect(await waitForRestoredTerminalInputReady(mantaPage, shellPtyId)).toBe(true)

  const afterAgent = buildSplitMarkerEcho('after-', 'agent')
  await focusActiveTerminalInput(mantaPage)
  await mantaPage.keyboard.type(afterAgent.command)
  await mantaPage.keyboard.press('Enter')
  await waitForTerminalOutput(mantaPage, afterAgent.marker, 15_000)

  const afterShiftEnter = buildSplitMarkerEcho('after-shift-', 'enter')
  await mantaPage.keyboard.press('Shift+Enter')
  await mantaPage.keyboard.type(afterShiftEnter.command)
  await mantaPage.keyboard.press('Enter')
  await waitForTerminalOutput(mantaPage, afterShiftEnter.marker, 15_000)
  await expect(mantaPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
