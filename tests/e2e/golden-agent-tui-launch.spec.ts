import { expect, test } from './helpers/manta-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { focusActiveTerminalInput, getTerminalContent } from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('launches an agent TUI with a live multiline composer', async ({ mantaPage }) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await configureGoldenStubAgent(mantaPage)
  await launchGoldenStubAgentFromNewTab(mantaPage)

  const activeTab = mantaPage.locator('[data-testid="sortable-tab"][data-active="true"]')
  await expect(activeTab).toHaveAttribute('data-tab-title', /Codex|Golden Stub Agent/i)

  await focusActiveTerminalInput(mantaPage)
  await mantaPage.keyboard.type('hello from e2e')
  await mantaPage.keyboard.press('Shift+Enter')
  await mantaPage.keyboard.type('second line')

  await expect
    .poll(() => getTerminalContent(mantaPage), { timeout: 10_000 })
    .toContain('> hello from e2e\r\n  second line')
  expect(await getTerminalContent(mantaPage)).not.toContain('GOLDEN_STUB_AGENT_SUBMITTED')
})
