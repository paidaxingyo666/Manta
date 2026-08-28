import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/manta-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const README_PATH = 'README.md'

test('@golden opens, edits, saves, and reopens a tracked file', async ({
  mantaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  const fixture = createGoldenWorktree(testRepoPath, 'file-save')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const sentinel = `Golden file save ${Date.now()}`
  const readmePath = path.join(fixture.worktreePath, README_PATH)

  await waitForSessionReady(mantaPage)
  await activateGoldenWorktree(mantaPage, testRepoPath, fixture.worktreePath)
  await mantaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await mantaPage.getByRole('button', { name: 'Explorer' }).click()

  const explorer = mantaPage.locator('[data-manta-explorer-shell]')
  // Why: after save the row's full text is "README.md M" from the git badge.
  const readmeRow = explorer.locator('[data-file-explorer-row]').filter({
    has: mantaPage.locator('[data-file-explorer-row-name]').getByText(README_PATH, { exact: true })
  })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.click()

  await expect(mantaPage.locator('.editor-header-path').first()).toContainText(README_PATH, {
    timeout: 20_000
  })
  const editor = mantaPage.locator('.rich-markdown-editor')
  await expect(editor).toBeVisible({ timeout: 25_000 })
  await expect(editor).toContainText('Manta E2E Test Repo')
  await editor.click()
  await mantaPage.keyboard.press('ControlOrMeta+End')
  await mantaPage.keyboard.press('Enter')
  await mantaPage.keyboard.type(sentinel)
  await mantaPage.keyboard.press('ControlOrMeta+S')

  await expect.poll(() => readFileSync(readmePath, 'utf8'), { timeout: 10_000 }).toContain(sentinel)
  const readmeTab = mantaPage.locator('[data-tab-id]').filter({ hasText: README_PATH }).last()
  await readmeTab.getByRole('button', { name: 'Close tab' }).click()
  await expect(
    mantaPage.locator('.editor-header-path').filter({ hasText: README_PATH })
  ).toHaveCount(0)

  await readmeRow.click()
  await expect(mantaPage.locator('.rich-markdown-editor')).toContainText(sentinel, {
    timeout: 25_000
  })
  await expect(explorer).toBeVisible()
  await expect(readmeRow).toBeVisible()
  await expect(
    mantaPage.getByText(path.basename(testRepoPath), { exact: true }).first()
  ).toBeVisible()
})
