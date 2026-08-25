import { randomUUID } from 'node:crypto'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/manta-app'
import { waitForSessionReady } from './helpers/store'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'

async function postCodexHookEvent(
  electronApp: ElectronApplication,
  paneKey: string,
  eventName: 'UserPromptSubmit' | 'Stop'
): Promise<void> {
  const endpoint = await readHookEndpoint(electronApp)
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/codex`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Manta-Agent-Hook-Token': endpoint.token
    },
    body: JSON.stringify({
      paneKey,
      tabId: 'e2e-caffeinate-tab',
      worktreeId: 'e2e-caffeinate-worktree',
      env: endpoint.env,
      version: endpoint.version,
      payload: { hook_event_name: eventName, prompt: 'e2e caffeinate prompt' }
    })
  })
  expect(response.status).toBe(204)
}

test('shows keep-awake mode and Agent activity in the status bar', async ({
  electronApp,
  mantaPage
}) => {
  await waitForSessionReady(mantaPage)

  const offStatus = mantaPage.getByRole('button', {
    name: 'Keep computer awake, Off · Inactive'
  })
  await expect(offStatus).toBeVisible()
  await expect(offStatus).toHaveText('Off')
  await offStatus.click()
  await expect(mantaPage.getByRole('menuitemradio', { name: /^On/ })).toBeVisible()
  await expect(mantaPage.getByRole('menuitemradio', { name: /^Agent/ })).toBeVisible()
  await expect(mantaPage.getByRole('menuitemradio', { name: /^Off/ })).toBeVisible()
  const menuProofPath = process.env.MANTA_CAFFEINATE_MENU_PROOF_PATH
  if (menuProofPath) {
    await mantaPage.screenshot({ path: menuProofPath })
  }
  await mantaPage.getByRole('menuitemradio', { name: /^Agent/ }).click()

  const agentInactiveStatus = mantaPage.getByRole('button', {
    name: 'Keep computer awake, Agent · Inactive'
  })
  await expect(agentInactiveStatus).toBeVisible()

  const paneKey = `e2e-caffeinate-tab:${randomUUID()}`
  await postCodexHookEvent(electronApp, paneKey, 'UserPromptSubmit')
  const agentActiveStatus = mantaPage.getByRole('button', {
    name: 'Keep computer awake, Agent · Active'
  })
  await expect(agentActiveStatus).toBeVisible()
  await expect(agentActiveStatus).toHaveText('Agent')

  const proofPath = process.env.MANTA_CAFFEINATE_PROOF_PATH
  if (proofPath) {
    await mantaPage.screenshot({ path: proofPath })
  }

  await postCodexHookEvent(electronApp, paneKey, 'Stop')
  await expect(agentInactiveStatus).toBeVisible()
})
