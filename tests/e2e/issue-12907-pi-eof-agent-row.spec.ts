import { test, expect } from './helpers/manta-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  stageNodeScriptForTerminal,
  type StagedTerminalNodeScript
} from './helpers/run-node-script-in-terminal'
import { worktreeRow } from './worktree-row-locators'

test('Pi EOF removes the completed agent row from the live Electron sidebar (#12907)', async ({
  mantaPage
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  const worktreeId = await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await waitForActiveTerminalManager(mantaPage)
  const ptyId = await waitForActivePanePtyId(mantaPage)
  await mantaPage.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('window.__store is unavailable')
    }
    state.setAgentActivityDisplayMode('full')
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.toggleWorktreeCardProperty('inline-agents')
    }
  })

  const script: StagedTerminalNodeScript = stageNodeScriptForTerminal(
    "process.stdout.write('PI_EOF_AGENT_READY\\r\\n\\x1b]0;Pi\\x07'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"
  )
  // Keep the shell from becoming the surviving process after the child accepts
  // EOF. The queued `exit` runs after node exits, on POSIX shells used here.
  await sendToTerminal(mantaPage, ptyId, `${script.command}; exit\r`)
  try {
    await waitForTerminalOutput(mantaPage, 'PI_EOF_AGENT_READY', 15_000)
    const agentRows = worktreeRow(mantaPage, worktreeId).locator('[aria-label="Agents"] > div')
    await expect(agentRows).toHaveCount(1)
    await mantaPage.screenshot({ path: testInfo.outputPath('pi-row-before-eof.png') })

    await sendToTerminal(mantaPage, ptyId, '\u0004')
    await expect(agentRows).toHaveCount(0, { timeout: 15_000 })
    await mantaPage.screenshot({ path: testInfo.outputPath('pi-row-after-eof.png') })
  } finally {
    script.cleanup()
  }
})
