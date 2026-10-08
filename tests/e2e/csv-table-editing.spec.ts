import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/manta-app'

test.use({
  mantaAppExtraArgs: process.env.ORCA_CSV_CDP_PORT
    ? [`--remote-debugging-port=${process.env.ORCA_CSV_CDP_PORT}`]
    : []
})

test('CSV table edits, inspection, clipboard and widths survive save and view switches', async ({
  mantaPage,
  seededRepoPath,
  electronApp
}, testInfo) => {
  const name = 'csv-table-editing.csv'
  const filePath = path.join(seededRepoPath, name)
  const original =
    '\ufeffName,Score,Description\r\nBeta,2,"Original text"\r\nAlpha,10,Second record\r\n'
  writeFileSync(filePath, original)
  await mantaPage.evaluate(
    async ({ filePath, name }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing CSV workspace')
      }
      await state.updateSettings({ editorAutoSave: false })
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
    { filePath, name }
  )
  const grid = mantaPage.getByTestId('csv-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  await mantaPage.screenshot({ path: testInfo.outputPath('csv-editable-before-interaction.png') })
  const beta = grid.getByRole('gridcell', { name: 'Beta', exact: true })
  await beta.dblclick()
  const input = mantaPage.getByRole('textbox', { name: /Edit row/ })
  await input.fill('Cancelled')
  await input.press('Escape')
  await expect(beta).toBeVisible()
  await expect
    .poll(() =>
      mantaPage.evaluate(() =>
        Object.values(window.__store?.getState().editorDrafts ?? {}).some((draft) =>
          draft.includes('Cancelled')
        )
      )
    )
    .toBe(false)
  await beta.dblclick()
  await input.fill('Beta updated')
  // Switch directly while the cell owns focus; the pending value must reach Source.
  await mantaPage.getByRole('radio', { name: 'Source', exact: true }).click()
  await expect(mantaPage.locator('.monaco-editor')).toBeVisible()
  await expect
    .poll(() =>
      mantaPage.evaluate(() =>
        Object.values(window.__store?.getState().editorDrafts ?? {}).some((draft) =>
          draft.includes('Beta updated')
        )
      )
    )
    .toBe(true)
  await mantaPage.getByRole('radio', { name: 'Table', exact: true }).click()
  await expect(grid.getByRole('gridcell', { name: 'Beta updated', exact: true })).toBeVisible()
  const separator = mantaPage.getByRole('separator', { name: 'Resize column 3', exact: true })
  const initialWidth = Number(await separator.getAttribute('aria-valuenow'))
  await separator.press('Shift+ArrowRight')
  const resized = String(initialWidth + 40)
  await expect(separator).toHaveAttribute('aria-valuenow', resized)
  await mantaPage.getByRole('radio', { name: 'Source', exact: true }).click()
  await mantaPage.getByRole('radio', { name: 'Table', exact: true }).click()
  await expect(separator).toHaveAttribute('aria-valuenow', resized!)
  await separator.press('Home')
  await grid.getByRole('gridcell', { name: 'Beta updated', exact: true }).click()
  await mantaPage.getByRole('button', { name: 'Sort', exact: true }).click()
  await mantaPage
    .getByRole('menuitem', { name: 'Sort selected column ascending', exact: true })
    .click()
  await expect(grid.getByRole('row').nth(1)).toContainText('Alpha')
  await mantaPage.getByRole('textbox', { name: 'Filter rows', exact: true }).fill('Alpha')
  await grid.getByRole('gridcell', { name: '10', exact: true }).dblclick()
  await input.fill('11')
  await input.press('Enter')
  await mantaPage.getByRole('textbox', { name: 'Filter rows', exact: true }).fill('')
  await grid.getByRole('gridcell', { name: 'Alpha', exact: true }).click()
  await grid.press('Shift+ArrowRight')
  await expect(grid.locator('[aria-selected="true"]')).toHaveCount(2)
  // DOM clipboard events exercise range handling without replacing the user's OS clipboard.
  const clipboard = await grid.evaluate((element) => {
    const copied = new DataTransfer()
    element.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: copied })
    )
    const pasted = new DataTransfer()
    pasted.setData('text/plain', 'Alpha renamed\t12')
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pasted })
    )
    return copied.getData('text/plain')
  })
  expect(clipboard).toBe('Alpha\t11')
  await expect(grid.getByRole('gridcell', { name: '12', exact: true })).toBeVisible()
  await mantaPage.getByRole('button', { name: 'Save', exact: true }).click()
  const expected =
    '\ufeffName,Score,Description\r\nBeta updated,2,"Original text"\r\nAlpha renamed,12,Second record\r\n'
  await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(expected)
  await mantaPage.screenshot({ path: testInfo.outputPath('csv-table-editing-after.png') })
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

test('CSV row and column operations preserve column widths and produce the expected file', async ({
  mantaPage,
  seededRepoPath
}, testInfo) => {
  const name = 'csv-structure.csv'
  const filePath = path.join(seededRepoPath, name)
  writeFileSync(filePath, 'First,Second,Third\nA,1,x\nB,2,y')
  await mantaPage.evaluate(
    async ({ filePath, name }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing CSV workspace')
      }
      await state.updateSettings({ editorAutoSave: false })
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
    { filePath, name }
  )
  const grid = mantaPage.getByTestId('csv-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  await grid.getByRole('gridcell', { name: '1', exact: true }).click()
  const secondWidth = mantaPage.getByRole('separator', { name: 'Resize column 2', exact: true })
  await secondWidth.press('ArrowRight')
  const width = await secondWidth.getAttribute('aria-valuenow')
  await mantaPage.getByRole('button', { name: 'Columns', exact: true }).click()
  await mantaPage.getByRole('menuitem', { name: 'Move column left', exact: true }).click()
  await expect(grid.getByRole('columnheader').nth(1)).toHaveText('Second')
  await expect(
    mantaPage.getByRole('separator', { name: 'Resize column 1', exact: true })
  ).toHaveAttribute('aria-valuenow', width!)
  await mantaPage.getByRole('button', { name: 'Columns', exact: true }).click()
  await mantaPage.getByRole('menuitem', { name: 'Insert column after', exact: true }).click()
  await expect(grid).toHaveAttribute('aria-colcount', '5')
  await grid.getByRole('columnheader', { name: 'Column 4', exact: true }).click()
  await mantaPage.getByRole('button', { name: 'Columns', exact: true }).click()
  await mantaPage.getByRole('menuitem', { name: 'Delete selected columns', exact: true }).click()
  await expect(grid).toHaveAttribute('aria-colcount', '4')
  await grid.getByRole('gridcell', { name: 'A', exact: true }).click()
  await mantaPage.getByRole('button', { name: 'Rows', exact: true }).click()
  await mantaPage.getByRole('menuitem', { name: 'Insert row below', exact: true }).click()
  await expect(grid).toHaveAttribute('aria-rowcount', '4')
  await grid.locator('[data-csv-row="2"][data-csv-column="0"]').click()
  await mantaPage.getByRole('button', { name: 'Rows', exact: true }).click()
  await mantaPage.getByRole('menuitem', { name: 'Delete selected rows', exact: true }).click()
  await expect(grid).toHaveAttribute('aria-rowcount', '3')
  await mantaPage.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('Second,First,Third\n1,A,x\n2,B,y')
  await mantaPage.screenshot({ path: testInfo.outputPath('csv-structure-after.png') })
})

test('keyboard selection reaches and edits a cell beyond both virtualized viewports', async ({
  mantaPage,
  seededRepoPath
}, testInfo) => {
  const filePath = path.join(seededRepoPath, 'editable-wide.csv')
  const header = Array.from({ length: 1024 }, (_, column) => `column-${column}`).join(',')
  const row = Array.from({ length: 1024 }, (_, column) => `v${column}`).join(',')
  writeFileSync(filePath, `${header}\n${`${row}\n`.repeat(100)}`)
  await mantaPage.evaluate(
    async ({ filePath }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing CSV workspace')
      }
      await state.updateSettings({ editorAutoSave: false })
      state.openFile(
        {
          filePath,
          relativePath: 'editable-wide.csv',
          worktreeId: state.activeWorktreeId,
          language: 'plaintext',
          mode: 'edit'
        },
        { preview: false }
      )
    },
    { filePath }
  )
  const grid = mantaPage.getByTestId('csv-grid')
  await expect(grid).toHaveAttribute('aria-colcount', '1025')
  // Dispatch on the clipped cell without Playwright scrolling it into view first.
  const clipped = await grid.evaluate((element) => {
    const viewport = element.closest('[data-testid="csv-scroll"]')
    if (!viewport) {
      throw new Error('Missing CSV scroll surface')
    }
    const edge = viewport.getBoundingClientRect().right
    const cell = [...element.querySelectorAll('[data-csv-row="1"]')].find((cell) => {
      const bounds = cell.getBoundingClientRect()
      return bounds.left < edge - 4 && bounds.right > edge + 4
    })
    if (!cell) {
      throw new Error('Missing clipped cell')
    }
    const column = Number(cell.getAttribute('data-csv-column'))
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return { column, scrollLeft: viewport.scrollLeft }
  })
  const clippedInput = mantaPage.getByRole('textbox', {
    name: `Edit row 2, column ${clipped.column + 1}`,
    exact: true
  })
  await expect(clippedInput).toBeFocused()
  expect(await mantaPage.getByTestId('csv-scroll').evaluate((element) => element.scrollLeft)).toBe(
    clipped.scrollLeft
  )
  await mantaPage.keyboard.type('z')
  await expect(clippedInput).toHaveValue(`zv${clipped.column}`)
  await expect(clippedInput).toBeFocused()
  await mantaPage.screenshot({ path: testInfo.outputPath('csv-clipped-cell-editor.png') })
  await mantaPage.getByTestId('csv-scroll').evaluate((element) => {
    element.scrollTop = 2000
  })
  await expect(clippedInput).toHaveCount(0)
  expect(
    await mantaPage.getByTestId('csv-scroll').evaluate((element) => element.scrollTop)
  ).toBeGreaterThan(0)
  await mantaPage.getByTestId('csv-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await grid.getByRole('gridcell', { name: 'v0', exact: true }).first().click()
  const modifier = await mantaPage.evaluate(() =>
    navigator.userAgent.includes('Mac') ? 'Meta' : 'Control'
  )
  await grid.press(`${modifier}+End`)
  const last = grid.locator('[data-csv-row="100"][data-csv-column="1023"]')
  await expect(last).toBeVisible()
  await expect(last).toHaveAttribute('data-active', 'true')
  await grid.press('F2')
  const input = mantaPage.getByRole('textbox', { name: 'Edit row 101, column 1024', exact: true })
  await input.fill('edited-final-cell')
  await input.press('Enter')
  await expect(last).toHaveText('edited-final-cell')
  expect(await grid.getByRole('columnheader').count()).toBeLessThan(40)
  expect(await grid.getByRole('row').count()).toBeLessThan(80)
  await mantaPage.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(() => readFileSync(filePath, 'utf8').split('\n').at(-2)?.split(',').at(-1))
    .toBe('edited-final-cell')
  expect(readFileSync(filePath, 'utf8').split('\n')[1]?.split(',')[clipped.column]).toBe(
    `zv${clipped.column}`
  )
})

test('autosave preserves an active cell while saving the previously committed draft', async ({
  mantaPage,
  seededRepoPath
}, testInfo) => {
  const filePath = path.join(seededRepoPath, 'csv-autosave.csv')
  writeFileSync(filePath, 'Name,Value\nA,1\nB,2')
  await mantaPage.evaluate(
    async ({ filePath }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing CSV workspace')
      }
      await state.updateSettings({ editorAutoSave: true, editorAutoSaveDelayMs: 1000 })
      state.openFile(
        {
          filePath,
          relativePath: 'csv-autosave.csv',
          worktreeId: state.activeWorktreeId,
          language: 'plaintext',
          mode: 'edit'
        },
        { preview: false }
      )
    },
    { filePath }
  )
  const grid = mantaPage.getByTestId('csv-grid')
  await grid.getByRole('gridcell', { name: 'A', exact: true }).dblclick()
  const input = mantaPage.getByRole('textbox', { name: /Edit row/ })
  await input.fill('committed')
  await input.press('Enter')
  await grid.getByRole('gridcell', { name: 'B', exact: true }).dblclick()
  await input.fill('still typing')
  await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('Name,Value\ncommitted,1\nB,2')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('still typing')
  await expect
    .poll(() =>
      mantaPage.evaluate(() => window.__store?.getState().openFiles.some((file) => file.isDirty))
    )
    .toBe(true)
  await mantaPage.screenshot({ path: testInfo.outputPath('csv-autosave-keeps-input.png') })
  await input.press('Enter')
  await expect
    .poll(() => readFileSync(filePath, 'utf8'))
    .toBe('Name,Value\ncommitted,1\nstill typing,2')
})
