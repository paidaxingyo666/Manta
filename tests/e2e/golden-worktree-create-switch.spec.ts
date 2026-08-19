import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/manta-app'
import { getActiveWorktreeId, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { createTerminalTabFromMenu } from './helpers/terminal-tab-menu'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { splitMarkerEchoCommand } from './terminal-marker-echo-command'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New workspace', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder(/Type a name/i).fill(name)
  await dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i }).click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })
}

async function removeCreatedWorktree(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate(async (id) => {
    await window.__store?.getState().removeWorktree(id, true)
  }, worktreeId)
}

test('creates a worktree, keeps its terminal isolated, and switches back @golden', async ({
  mantaPage
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(mantaPage)
  const originalWorktreeId = await waitForActiveWorktree(mantaPage)
  await waitForActiveTerminalManager(mantaPage, 30_000)
  const parentPtyId = await waitForActivePanePtyId(mantaPage)
  const workspaceName = `golden-switch-${Date.now()}`
  let childWorktreeId: string | null = null

  try {
    await createWorkspace(mantaPage, workspaceName)
    await expect(
      mantaPage.locator('[role="option"][aria-current="page"]').filter({ hasText: workspaceName })
    ).toBeVisible({ timeout: 30_000 })
    childWorktreeId = await waitForActiveWorktree(mantaPage)
    // Why: the cleanup force-removes childWorktreeId, so it must never resolve to the original.
    expect(childWorktreeId).not.toBe(originalWorktreeId)
    await expect(
      mantaPage.locator(`[role="option"][data-worktree-id="${childWorktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page')

    await createTerminalTabFromMenu(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)
    const childPtyId = await waitForActivePanePtyId(mantaPage)
    expect(childPtyId).not.toBe(parentPtyId)
    await waitForPtyShellEcho(mantaPage, childPtyId, 15_000)
    await execInTerminal(mantaPage, childPtyId, splitMarkerEchoCommand('worktree', '-b'))
    await waitForTerminalOutput(mantaPage, 'worktree-b')

    await mantaPage.locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`).click()
    await expect(
      mantaPage.locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })
    await waitForActiveTerminalManager(mantaPage, 30_000)
    expect(await waitForActivePanePtyId(mantaPage, 30_000)).toBe(parentPtyId)
  } finally {
    if (childWorktreeId) {
      if ((await getActiveWorktreeId(mantaPage).catch(() => null)) !== originalWorktreeId) {
        await mantaPage
          .locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`)
          .click()
          .catch(() => undefined)
      }
      await removeCreatedWorktree(mantaPage, childWorktreeId).catch(() => undefined)
    }
  }
})
