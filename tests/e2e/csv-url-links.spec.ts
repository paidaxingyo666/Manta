import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/manta-app'

test('dense CSVs below 1 MiB remain visible and shrinking a later row window recovers', async ({
  mantaPage,
  seededRepoPath,
  electronApp
}, testInfo) => {
  const name = 'dense-small.csv'
  const filePath = path.join(seededRepoPath, name)
  writeFileSync(filePath, `id\n${'\n'.repeat(600_000)}`)
  await mantaPage.evaluate(
    ({ name, filePath }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing dense CSV workspace')
      }
      state.openFile(
        {
          filePath,
          relativePath: name,
          worktreeId: state.activeWorktreeId,
          language: 'plaintext',
          mode: 'edit'
        },
        { preview: false }
      )
    },
    { name, filePath }
  )
  await expect(mantaPage.getByRole('table')).toHaveAttribute('aria-rowcount', '600001')
  await mantaPage.getByRole('button', { name: 'Next rows' }).click()
  await expect(mantaPage.getByRole('rowheader', { name: '500001', exact: true })).toBeVisible()
  await mantaPage.getByTestId('csv-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(mantaPage.getByRole('rowheader', { name: '600000', exact: true })).toBeVisible()
  await mantaPage.evaluate(() => {
    const state = window.__store?.getState()
    const file = state?.openFiles.find((file) => file.filePath.endsWith('dense-small.csv'))
    if (!state || !file) {
      throw new Error('Missing dense CSV tab')
    }
    state.setEditorDraft(file.id, 'id\nfirst\nsecond\nthird\n')
  })
  await expect(mantaPage.getByRole('table')).toHaveAttribute('aria-rowcount', '4')
  await expect(mantaPage.getByRole('cell', { name: 'first', exact: true })).toBeVisible()
  await expect(mantaPage.getByRole('cell', { name: 'third', exact: true })).toBeVisible()
  await expect(mantaPage.getByRole('button', { name: 'Next rows' })).toHaveCount(0)
  await mantaPage.screenshot({ path: testInfo.outputPath('dense-after-shrink.png') })
  if (
    process.env.MANTA_E2E_FORCE_HEADFUL !== '1' &&
    testInfo.project.metadata.mantaHeadful !== true
  ) {
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  }
})

test('CSV links navigate from small and paged previews without replacing the renderer', async ({
  mantaPage,
  seededRepoPath,
  electronApp
}, testInfo) => {
  test.setTimeout(90_000)
  const url = 'https://example.com/?from=csv#demo'
  const smallName = 'csv-links.csv'
  const largeName = 'csv-links-large.csv'
  const content = `name,url,notes\nExample,${url},javascript:alert(1)\n`
  writeFileSync(path.join(seededRepoPath, smallName), content)
  writeFileSync(
    path.join(seededRepoPath, largeName),
    content + `Record,${url},${'x'.repeat(200)}\n`.repeat(6000)
  )
  await mantaPage.evaluate(async () => {
    await window.__store?.getState().updateSettings({ openLinksInApp: true })
  })
  for (const name of [smallName, largeName]) {
    await mantaPage.evaluate(
      ({ name, filePath }) => {
        const state = window.__store?.getState()
        if (!state?.activeWorktreeId) {
          throw new Error('Missing CSV test workspace')
        }
        state.openFile(
          {
            filePath,
            relativePath: name,
            worktreeId: state.activeWorktreeId,
            language: 'plaintext',
            mode: 'edit'
          },
          { preview: false }
        )
      },
      { name, filePath: path.join(seededRepoPath, name) }
    )
    const link = mantaPage.getByRole('table').getByRole('link', { name: url }).first()
    await expect(link).toBeVisible({ timeout: 30_000 })
    await expect(link).toHaveAttribute('href', url)
    await expect(
      mantaPage.getByRole('cell', { name: 'javascript:alert(1)', exact: true })
    ).toBeVisible()
    await mantaPage.screenshot({ path: testInfo.outputPath(`${name}.png`) })
    const rendererUrl = mantaPage.url()
    const tabsBefore = await mantaPage.evaluate(
      () => Object.values(window.__store?.getState().browserTabsByWorktree ?? {}).flat().length
    )
    if (name === largeName) {
      await link.focus()
      await mantaPage.keyboard.press('Enter')
    } else {
      await link.click()
    }
    await expect
      .poll(() =>
        mantaPage.evaluate(
          () => Object.values(window.__store?.getState().browserTabsByWorktree ?? {}).flat().length
        )
      )
      .toBe(tabsBefore + 1)
    expect(
      await mantaPage.evaluate(
        () =>
          Object.values(window.__store?.getState().browserTabsByWorktree ?? {})
            .flat()
            .at(-1)?.url
      )
    ).toBe(url)
    expect(mantaPage.url()).toBe(rendererUrl)
  }
  if (
    process.env.MANTA_E2E_FORCE_HEADFUL !== '1' &&
    testInfo.project.metadata.mantaHeadful !== true
  ) {
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  }
})
