import { test, expect } from './helpers/manta-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  sendToTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

test('Pi modal hooks show the existing waiting-for-input indicator', async ({
  mantaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await waitForActiveTerminalManager(mantaPage, 30_000)
  const endpoint = await readHookEndpoint(electronApp)
  const ptyId = await waitForActivePanePtyId(mantaPage)
  const marker = '__PI_MODAL_STATUS_READY__'
  await sendToTerminal(mantaPage, ptyId, `printf '${marker}\\n'\r`)
  await waitForTerminalOutput(mantaPage, marker)
  const { paneKey, worktreeId } = await waitForActivePaneHookDescriptor(mantaPage)

  async function emit(payload: Record<string, unknown>): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/pi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Manta-Agent-Hook-Token': endpoint.token
      },
      body: JSON.stringify({
        paneKey,
        tabId: paneKey.split(':')[0],
        worktreeId,
        env: endpoint.env,
        version: endpoint.version,
        payload
      })
    })
    expect(response.status).toBe(204)
  }

  // Terminal tabs present both waiting and blocked as "Needs attention".
  const waiting = mantaPage.locator('[aria-label="Needs attention"]')
  await emit({ hook_event_name: 'before_agent_start', prompt: 'Pi modal status check' })
  await expect(mantaPage.locator('[aria-label="Working"]').first()).toBeVisible()
  await mantaPage.screenshot({ path: testInfo.outputPath('before-working.png') })

  await emit({ hook_event_name: 'ui_prompt_start', ui_prompt_active: true })
  await expect
    .poll(() =>
      mantaPage.evaluate(
        (key) => window.__store?.getState().agentStatusByPaneKey[key]?.state,
        paneKey
      )
    )
    .toBe('waiting')
  await expect(waiting.first()).toBeVisible()
  await mantaPage.screenshot({ path: testInfo.outputPath('after-waiting.png') })
  await emit({ hook_event_name: 'tool_execution_end', tool_name: 'bash', ui_prompt_active: true })
  await expect(waiting.first()).toBeVisible()

  await emit({ hook_event_name: 'ui_prompt_end', is_idle: false })
  await expect(waiting).toHaveCount(0)
  await expect(mantaPage.locator('[aria-label="Working"]').first()).toBeVisible()
  await emit({ hook_event_name: 'agent_end' })
  await expect(mantaPage.locator('[aria-label="Working"]')).toHaveCount(0)
  await expect(waiting).toHaveCount(0)
})
