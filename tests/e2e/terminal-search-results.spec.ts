import { test, expect } from './helpers/manta-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

test('terminal search counts real matches and repeat find selects the query', async ({
  mantaPage
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await waitForActiveTerminalManager(mantaPage, 30_000)
  const ptyId = await waitForActivePanePtyId(mantaPage)
  for (let line = 0; line < 3; line++) {
    await execInTerminal(mantaPage, ptyId, 'echo manta-search-proof')
  }
  await expect
    .poll(
      async () =>
        (await getTerminalContent(mantaPage))
          .split(/\r?\n/)
          .filter((line) => line.trim() === 'manta-search-proof').length
    )
    .toBe(3)
  await focusActiveTerminalInput(mantaPage)
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await mantaPage.keyboard.press(`${modifier}+f`)
  const search = mantaPage.locator('[data-terminal-search-root]')
  const input = search.locator('input')
  await expect(input).toBeFocused()
  await search.getByTitle('Regex', { exact: true }).click()
  const query = '^manta-search-proof$'
  await input.fill(query)
  await expect(search).toContainText(/[1-3]\/3/)
  const initialCount = await search.innerText()
  await input.press('Enter')
  await expect.poll(() => search.innerText()).not.toBe(initialCount)
  await mantaPage.screenshot({ path: testInfo.outputPath('search-results.png') })
  await input.press('ArrowLeft')
  await mantaPage.keyboard.press(`${modifier}+f`)
  await expect(input).toBeFocused()
  await expect
    .poll(() =>
      input.evaluate((element) => ({ start: element.selectionStart, end: element.selectionEnd }))
    )
    .toEqual({ start: 0, end: query.length })
  await mantaPage.screenshot({ path: testInfo.outputPath('search-query-selected.png') })
  await input.fill('no-such-search-result-314159')
  await expect(search).toContainText('No results')
  await input.press('Escape')
  await expect(search).toBeHidden()
})
