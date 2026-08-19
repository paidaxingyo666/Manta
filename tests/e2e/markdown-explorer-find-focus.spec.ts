import { expect, test } from './helpers/manta-app'
import { openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  mantaPage
}) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await openFileExplorer(mantaPage)

  const readmeRow = mantaPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(mantaPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  await pressShortcut(mantaPage, 'f')

  await expect(
    mantaPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
