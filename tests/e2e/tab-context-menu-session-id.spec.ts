/**
 * E2E coverage for copying an agent provider session ID from a terminal tab's
 * context menu.
 */

import { test, expect } from './helpers/manta-app'
import {
  ensureTerminalVisible,
  getActiveTabId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { waitForPaneIdentitySnapshot } from './helpers/terminal'

const SESSION_ID = 'e2e-terminal-tab-session'

test('terminal tab context menu copies the active agent session ID', async ({ mantaPage }) => {
  await waitForSessionReady(mantaPage)
  const worktreeId = await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)

  const tabId = await getActiveTabId(mantaPage)
  if (!tabId) {
    throw new Error('No active terminal tab')
  }
  const snapshot = await waitForPaneIdentitySnapshot(mantaPage, 1)
  const leafId = snapshot.panes[0]?.leafId
  if (!leafId) {
    throw new Error('No active terminal pane')
  }
  const paneKey = `${tabId}:${leafId}`

  // Seed the same renderer state a live agent hook produces while keeping the
  // test independent of an installed provider CLI.
  await mantaPage.evaluate(
    ({ paneKey, tabId, worktreeId, sessionId }) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Store unavailable')
      }
      state.setAgentStatus(
        paneKey,
        { state: 'working', prompt: 'copy session id', agentType: 'claude' },
        'Claude',
        undefined,
        { tabId, worktreeId },
        { providerSession: { key: 'session_id', id: sessionId } }
      )
    },
    { paneKey, tabId, worktreeId, sessionId: SESSION_ID }
  )

  await expect
    .poll(
      () =>
        mantaPage.evaluate(
          ({ paneKey }) =>
            window.__store?.getState().agentStatusByPaneKey[paneKey]?.providerSession?.id,
          { paneKey }
        ),
      { timeout: 3_000 }
    )
    .toBe(SESSION_ID)

  const tab = mantaPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
  await expect(tab).toBeVisible()
  await tab.click({ button: 'right' })

  const copyItem = mantaPage.getByRole('menuitem', { name: 'Copy Session ID', exact: true })
  await expect(copyItem).toBeVisible()
  await copyItem.click()

  await expect
    .poll(() => mantaPage.evaluate(() => window.api.ui.readClipboardText()), { timeout: 3_000 })
    .toBe(SESSION_ID)
})
