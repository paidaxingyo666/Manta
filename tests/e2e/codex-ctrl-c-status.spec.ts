import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/manta-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  waitForActivePaneHookDescriptor,
  waitForActiveTerminalManager
} from './helpers/terminal'

test('Codex Ctrl+C preserves working status until a confirmed interruption', async ({
  mantaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await waitForActiveTerminalManager(mantaPage, 30_000)
  const endpoint = await readHookEndpoint(electronApp)
  const descriptor = await waitForActivePaneHookDescriptor(mantaPage)
  await mantaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setAgentActivityDisplayMode('full')
    if (state && !state.worktreeCardProperties.includes('inline-agents')) {
      state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
    }
  })
  const dir = mkdtempSync(join(tmpdir(), 'orca-codex-interruption-'))
  const transcriptPath = join(dir, 'rollout-root.jsonl')
  writeFileSync(
    transcriptPath,
    `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } })}\n`
  )
  try {
    await emitCodexHookStatus(endpoint, {
      ...descriptor,
      transcriptPath,
      sessionId: 'main-session',
      state: 'working',
      prompt: 'Main task continues'
    })
    const working = mantaPage.locator('[aria-label="Working"]')
    const interrupted = mantaPage.locator('[aria-label="Interrupted"]')
    await expect(working.first()).toBeVisible()
    await emitCodexHookStatus(endpoint, {
      ...descriptor,
      state: 'working',
      sessionId: 'side-session',
      transcriptPath: null,
      prompt: 'Side chat'
    })
    await expect(mantaPage.getByText('Main task continues', { exact: true })).toBeVisible()
    await focusActiveTerminalInput(mantaPage)
    await mantaPage.keyboard.press('Control+c')
    // Allow the old 500 ms inference timer to fire before recording the rendered result.
    await mantaPage.waitForTimeout(1_000)
    await mantaPage.screenshot({
      path: testInfo.outputPath('status-after-ctrl-c.png'),
      clip: { x: 0, y: 180, width: 280, height: 240 }
    })
    await expect(interrupted).toHaveCount(0)
    await expect(working.first()).toBeVisible()

    appendFileSync(
      transcriptPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'turn-1', reason: 'interrupted' } })}\n`
    )
    await expect(interrupted.first()).toBeVisible()
    await expect(working).toHaveCount(0)
    await mantaPage.screenshot({
      path: testInfo.outputPath('status-after-confirmed-interruption.png'),
      clip: { x: 0, y: 180, width: 280, height: 240 }
    })
    await emitCodexHookStatus(endpoint, {
      ...descriptor,
      state: 'working',
      prompt: 'Next main task'
    })
    await expect(working.first()).toBeVisible()
    await expect(interrupted).toHaveCount(0)
    await emitCodexHookStatus(endpoint, { ...descriptor, state: 'done' })
    await expect(working).toHaveCount(0)
    await expect(interrupted).toHaveCount(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
