import type { Locator } from '@stablyai/playwright-test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/manta-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('sparse preset editor visual proof', async ({ mantaPage }, testInfo) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await mantaPage.setViewportSize({ width: 1200, height: 800 })
  const board = mantaPage.getByRole('button', { name: 'Workspace board', exact: true })
  await board.click()
  await board.click()
  await mantaPage.evaluate(() => {
    window.__store!.getState().openModal('new-workspace-composer', {})
  })
  const capture = async (name: string) => {
    const file = process.env.ORCA_SPARSE_PROOF_DIR
      ? path.resolve(process.env.ORCA_SPARSE_PROOF_DIR, `${name}.png`)
      : testInfo.outputPath(`${name}.png`)
    mkdirSync(path.dirname(file), { recursive: true })
    await mantaPage.mouse.move(20, 20)
    await expect(mantaPage.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15000 })
    await expect(
      mantaPage.getByRole('tooltip').filter({ hasText: 'Workspace board moved to the bottom bar' })
    ).toBeHidden({ timeout: 20000 })
    await mantaPage.screenshot({ path: file, animations: 'disabled' })
    await testInfo.attach(name, { path: file, contentType: 'image/png' })
  }
  // Why: free-form entry keeps the proof independent of the fixture repo's real folders.
  const addDirectory = async (scope: Locator, directory: string): Promise<void> => {
    await scope.getByRole('combobox', { name: 'Add a folder' }).click()
    await mantaPage
      .getByRole('combobox', { name: 'Find a folder, or type any path…' })
      .fill(directory)
    await mantaPage.locator(`[data-value="__literal__:${directory}"]`).click()
    await expect(scope.getByRole('button', { name: `Remove ${directory}` })).toBeVisible()
  }
  await mantaPage.getByRole('button', { name: 'Advanced', exact: true }).click()
  await mantaPage.getByRole('combobox', { name: 'Checkout preset' }).click()
  await mantaPage.getByRole('button', { name: 'New preset', exact: true }).click()
  await expect(mantaPage.getByLabel('Name', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'false'
  )
  await expect(mantaPage.getByText('No folders added yet.')).toBeVisible()
  await capture('preset-pristine')
  const baseline = process.env.ORCA_SPARSE_PROOF_BASELINE === '1'
  await mantaPage.getByLabel('Name', { exact: true }).fill('Web app and shared UI')
  const composerEditor = mantaPage.getByRole('region', { name: 'New sparse preset' })
  const initialDirectories = [
    'apps/web',
    'packages/ui',
    'packages/design-tokens',
    'packages/icons',
    'packages/analytics',
    'packages/auth'
  ]
  for (const directory of initialDirectories) {
    await addDirectory(composerEditor, directory)
  }
  await capture('preset-editor')
  await expect(mantaPage.getByRole('button', { name: 'Advanced', exact: true })).toBeDisabled()
  if (baseline) {
    return
  }
  const editor = mantaPage.getByRole('region', { name: 'New sparse preset' })
  await expect(editor).toBeVisible()
  await expect(mantaPage.getByRole('button', { name: /^Create worktree/ })).toHaveCount(0)
  await expect(mantaPage.getByRole('dialog')).toHaveCount(1)
  await expect(mantaPage.locator('[data-workspace-composer-root]')).toHaveAttribute(
    'data-sparse-preset-editing',
    'true'
  )
  await expect(editor.getByRole('button', { name: /^Remove / })).toHaveCount(
    initialDirectories.length
  )
  await editor.getByRole('combobox', { name: 'Add a folder' }).click()
  const pathInput = mantaPage.getByRole('combobox', { name: 'Find a folder, or type any path…' })
  await pathInput.fill('../outside')
  await expect(
    mantaPage.getByText(
      'Use repo-relative directories, not root, absolute paths, or parent segments.'
    )
  ).toBeVisible()
  await expect(mantaPage.locator('[data-value^="__literal__:"]')).toHaveCount(0)
  await capture('preset-validation')
  await mantaPage.keyboard.press('Escape')
  for (const directory of initialDirectories.slice(2)) {
    await editor.getByRole('button', { name: `Remove ${directory}` }).click()
  }
  await expect(editor.getByRole('button', { name: /^Remove / })).toHaveCount(2)
  await editor.getByRole('button', { name: 'Save preset', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(
    mantaPage.getByRole('combobox').filter({ hasText: /^Web app and shared UI$/ })
  ).toBeFocused()
  await mantaPage
    .getByRole('combobox')
    .filter({ hasText: /^Web app and shared UI$/ })
    .click()
  await expect(mantaPage.getByRole('combobox', { name: 'Find a preset…' })).toBeFocused()
  await mantaPage.getByRole('combobox', { name: 'Find a preset…' }).fill('packages/ui')
  await capture('preset-search')
  const chooser = mantaPage.locator('[data-slot="popover-content"]').filter({
    has: mantaPage.getByRole('combobox', { name: 'Find a preset…' })
  })
  const presetTrigger = mantaPage.getByRole('combobox', { name: 'Checkout preset' })
  await expect
    .poll(async () => {
      const popup = await chooser.boundingBox()
      const trigger = await presetTrigger.boundingBox()
      if (!popup || !trigger) {
        return Infinity
      }
      return Math.min(
        Math.abs(popup.y + popup.height - trigger.y),
        Math.abs(trigger.y + trigger.height - popup.y)
      )
    })
    .toBeLessThanOrEqual(1)
  await mantaPage.getByRole('combobox', { name: 'Find a preset…' }).press('Enter')
  await expect(chooser).toHaveCount(0)
  await expect(presetTrigger).toBeFocused()
  await presetTrigger.click()
  const originalPresets = await mantaPage.evaluate(() => {
    const store = window.__store!
    const state = store.getState()
    const original = state.sparsePresetsByRepo
    const selected = Object.values(original)
      .flat()
      .find((preset) => preset.name === 'Web app and shared UI')!
    store.setState({
      sparsePresetsByRepo: {
        ...original,
        [selected.repoId]: [
          ...original[selected.repoId],
          ...Array.from({ length: 24 }, (_, index) => ({
            ...selected,
            id: `proof-${index}`,
            name: `Team ${index} services`,
            directories: [`services/team-${index}/a-long-directory-name`]
          }))
        ]
      }
    })
    return original
  })
  const resultList = chooser.locator('[cmdk-list]')
  await resultList.hover()
  await mantaPage.mouse.wheel(0, 600)
  await expect.poll(() => resultList.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await capture('preset-many')
  await expect(mantaPage.getByRole('button', { name: 'New preset', exact: true })).toBeInViewport()
  await mantaPage.getByRole('combobox', { name: 'Find a preset…' }).fill('team-23')
  await expect(mantaPage.getByRole('option', { name: /Team 23 services/ })).toBeVisible()
  await capture('preset-many-filtered')
  await mantaPage.evaluate(
    (original) => window.__store!.setState({ sparsePresetsByRepo: original }),
    originalPresets
  )
  await mantaPage.getByRole('combobox', { name: 'Find a preset…' }).fill('')
  await mantaPage.setViewportSize({ width: 800, height: 640 })
  await mantaPage.getByRole('button', { name: 'Edit Web app and shared UI', exact: true }).click()
  const edit = mantaPage.getByRole('region', { name: 'Edit sparse preset' })
  await expect(edit.getByRole('button', { name: 'Remove apps/web' })).toBeVisible()
  await expect(edit.getByRole('button', { name: 'Remove packages/ui' })).toBeVisible()
  await mantaPage.evaluate(async () => {
    await window.__store!.getState().updateSettingsOrThrow({ theme: 'dark' })
  })
  await expect(edit.getByRole('button', { name: 'Save preset', exact: true })).toBeInViewport()
  await expect(edit.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
  await capture('preset-narrow-dark')
  await edit.getByLabel('Name', { exact: true }).focus()
  await mantaPage.keyboard.press('Escape')
  await expect(edit).toHaveCount(0)
  await expect(mantaPage.getByRole('dialog')).toHaveCount(1)
  await mantaPage.setViewportSize({ width: 1200, height: 800 })
  await mantaPage
    .getByRole('combobox')
    .filter({ hasText: /^Web app and shared UI$/ })
    .click()
  await mantaPage.getByRole('combobox', { name: 'Find a preset…' }).fill('nothing-matches')
  await expect(mantaPage.getByText('No matching presets.')).toBeVisible()
  await capture('preset-no-matches')
  await mantaPage.getByRole('button', { name: 'New preset', exact: true }).click()
  const second = mantaPage.getByRole('region', { name: 'New sparse preset' })
  await second.getByLabel('Name', { exact: true }).fill('web app and shared ui')
  await addDirectory(second, 'packages/ui')
  await expect(
    second.getByText('A preset named “Web app and shared UI” already exists.')
  ).toBeVisible()
  await expect(second.getByRole('button', { name: 'Save preset', exact: true })).toBeDisabled()
  await capture('preset-duplicate')
  await second.getByLabel('Name', { exact: true }).fill('Shared UI')
  await mantaPage.evaluate(() => {
    const store = window.__store!
    const save = store.getState().saveSparsePreset
    store.setState({
      saveSparsePreset: async () => {
        store.setState({ saveSparsePreset: save })
        throw new Error('Proof fixture: persistence unavailable')
      }
    })
  })
  await second.getByRole('button', { name: 'Save preset', exact: true }).click()
  await expect(second.getByRole('alert')).toHaveText('Could not save the preset. Try again.')
  await expect(second.getByLabel('Name', { exact: true })).toHaveValue('Shared UI')
  const errorBox = await second.getByRole('alert').boundingBox()
  const saveBox = await second
    .getByRole('button', { name: 'Save preset', exact: true })
    .boundingBox()
  expect(errorBox).not.toBeNull()
  expect(saveBox).not.toBeNull()
  expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual(saveBox!.y)
  await capture('preset-save-error')
  await mantaPage.evaluate(() => {
    const store = window.__store!
    const save = store.getState().saveSparsePreset
    store.setState({
      saveSparsePreset: async (args) => {
        store.setState({ saveSparsePreset: save })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return save(args)
      }
    })
  })
  await second.getByRole('button', { name: 'Save preset', exact: true }).click()
  await expect(second.getByRole('button', { name: 'Save preset', exact: true })).toBeDisabled()
  await expect(second.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await expect(second.getByLabel('Name', { exact: true })).toBeDisabled()
  await mantaPage.keyboard.press('Escape')
  await expect(second).toBeVisible()
  await expect(second).toHaveCount(0)
  await mantaPage.keyboard.press('Escape')
  await mantaPage.evaluate(() => {
    const state = window.__store!.getState()
    const active = Object.values(state.worktreesByRepo)
      .flat()
      .find((w) => w.id === state.activeWorktreeId)!
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'repo', repoId: active.repoId })
    state.openSettingsPage()
  })
  await mantaPage.getByRole('button', { name: 'New Preset', exact: true }).click()
  const settingsEditor = mantaPage.getByRole('region', { name: 'New sparse preset' })
  await settingsEditor.getByLabel('Name', { exact: true }).fill('web app and shared ui')
  await addDirectory(settingsEditor, 'apps/web')
  await expect(
    settingsEditor.getByText('A preset named “Web app and shared UI” already exists.')
  ).toBeVisible()
  await expect(mantaPage.getByRole('dialog')).toHaveCount(0)
  await capture('preset-settings')
  await settingsEditor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(mantaPage.getByRole('button', { name: 'New Preset', exact: true })).toBeFocused()
  await mantaPage
    .getByRole('button', { name: /^Edit (Shared UI|Web app and shared UI)$/ })
    .first()
    .click()
  const settingsEdit = mantaPage.getByRole('region', { name: 'Edit sparse preset' })
  await expect(settingsEdit).toBeVisible()
  await expect(
    mantaPage.getByRole('button', { name: /^Edit (Shared UI|Web app and shared UI)$/ })
  ).toBeDisabled()
  await capture('preset-settings-edit')
  await settingsEdit.getByRole('button', { name: 'Cancel', exact: true }).click()
})
