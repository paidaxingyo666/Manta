import { readFile, writeFile } from 'node:fs/promises'
import { buildShellCommandFromArgv } from '../../src/shared/tui-agent-startup-shell'
import { test, expect } from './helpers/manta-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

test('OMP model picker dispatches its advertised command and adopts the host report', async ({
  mantaPage,
  electronApp
}, testInfo) => {
  test.skip(process.platform === 'win32', 'POSIX PTY capture fixture')
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await waitForActiveTerminalManager(mantaPage)
  const descriptor = await waitForActivePaneHookDescriptor(mantaPage)
  const ptyId = await waitForActivePanePtyId(mantaPage)
  const output = testInfo.outputPath('model-command.txt')
  const script = testInfo.outputPath('capture.cjs')
  await writeFile(
    script,
    `const fs = require('node:fs'); let data = ''; process.stdin.setRawMode(true); process.stdin.on('data', chunk => { data += chunk; fs.writeFileSync(${JSON.stringify(output)}, data); });`
  )
  await execInTerminal(
    mantaPage,
    ptyId,
    buildShellCommandFromArgv([process.execPath, script], 'posix')
  )
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('git:discoverCommitMessageModels')
    ipcMain.handle('git:discoverCommitMessageModels', () => ({
      success: true,
      catalogOrigin: 'probe',
      models: [
        { id: 'anthropic/claude-sonnet-4-5', label: 'Sonnet 4.5' },
        { id: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6' }
      ]
    }))
  })
  await mantaPage.evaluate(async ({ paneKey, worktreeId }) => {
    const settings = await window.api.settings.set({ experimentalNativeChat: true })
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    store.setState({ settings })
    const state = store.getState()
    state.setAgentStatus(
      paneKey,
      {
        state: 'idle',
        prompt: '',
        agentType: 'omp',
        model: 'anthropic/claude-sonnet-4-5',
        modelSwitchCommand: 'manta-model'
      },
      'OMP',
      undefined,
      { worktreeId }
    )
    const [tabId] = paneKey.split(':')
    const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
    )
    if (!tab) {
      throw new Error('Terminal tab unavailable')
    }
    state.toggleTabViewMode(tab.id)
  }, descriptor)
  const picker = mantaPage.getByRole('button', { name: 'Model Sonnet 4.5', exact: true })
  await expect(picker).toBeVisible()
  await picker.click()
  await expect(
    mantaPage.getByRole('menuitemradio', { name: 'Sonnet 4.6', exact: true })
  ).toBeVisible()
  await mantaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('omp-model-choices.png')
  })
  await mantaPage.getByRole('menuitemradio', { name: 'Sonnet 4.6', exact: true }).click()
  await expect
    .poll(async () => readFile(output, 'utf8').catch(() => ''))
    .toContain('/manta-model anthropic/claude-sonnet-4-6')
  await mantaPage.evaluate(({ paneKey, worktreeId }) => {
    window.__store?.getState().setAgentStatus(
      paneKey,
      {
        state: 'idle',
        prompt: '',
        agentType: 'omp',
        model: 'anthropic/claude-sonnet-4-6',
        modelSwitchCommand: 'manta-model'
      },
      'OMP',
      undefined,
      { worktreeId }
    )
  }, descriptor)
  await expect(
    mantaPage.getByRole('button', { name: 'Model Sonnet 4.6', exact: true })
  ).toBeVisible()
  await mantaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('omp-model-reported.png')
  })
})
