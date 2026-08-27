import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/manta-app'
import {
  ensureTerminalVisible,
  getActiveTabId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  readPaneIdentitySnapshot,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'
import { stageNodeScriptForTerminal } from './helpers/run-node-script-in-terminal'

async function activateTerminalTab(page: Page, tabId: string): Promise<void> {
  await page.evaluate((id) => {
    const state = window.__store?.getState()
    state?.setActiveTab(id)
    state?.setActiveTabType('terminal')
  }, tabId)
  await expect
    .poll(() =>
      page.locator('[data-testid="sortable-tab"][data-active="true"]').getAttribute('data-tab-id')
    )
    .toBe(tabId)
}

for (const exitMode of ['normal', 'sigkill'] as const) {
  test(`clears modes when a child TUI exits via ${exitMode} while its shell survives hidden`, async ({
    electronApp,
    mantaPage
  }) => {
    await installTerminalPtyWriteSpy(electronApp)
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
    await ensureTerminalVisible(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)

    const shellTabId = (await getActiveTabId(mantaPage))!
    const child = [
      "process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdout.write('\\x1b[?1049h\\x1b[?1003h\\x1b[?1006h\\x1b[?25lCHILD_TUI_STARTED\\r\\n')",
      ...(exitMode === 'normal'
        ? [
            "process.on('SIGTERM', () => { process.stdout.write('\\x1b[?1006l\\x1b[?1003l\\x1b[?1049l\\x1b[?25h'); process.exit(0) })"
          ]
        : []),
      "setInterval(() => process.stdout.write('\\x1b[2J\\x1b[HCHILD_TUI_FRAME\\r\\n'), 80)"
    ].join(';')
    const parent = [
      `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});`,
      "process.stdout.write('CHILD_TUI_PID_' + child.pid + '\\r\\n');",
      "child.on('exit', () => process.stdout.write('\\r\\nCHILD_TUI_KILLED\\r\\n'))"
    ].join(' ')
    const command = stageNodeScriptForTerminal(parent, { prefix: 'orca-child-tui-kill' }).command
    const tuiTabId = await mantaPage.evaluate(
      ({ command }) => {
        const state = window.__store?.getState()
        const worktreeId = state?.activeWorktreeId
        if (!state || !worktreeId) {
          throw new Error('store/worktree unavailable')
        }
        const tab = state.createTab(worktreeId)
        state.queueTabStartupCommand(tab.id, { command })
        state.setActiveTab(tab.id)
        state.setActiveTabType('terminal')
        return tab.id
      },
      { command }
    )

    await expect.poll(() => getActiveTabId(mantaPage), { timeout: 5_000 }).toBe(tuiTabId)
    const tuiPtyId = await waitForActivePanePtyId(mantaPage, 30_000)
    const tuiIdentity = await readPaneIdentitySnapshot(mantaPage)
    expect(tuiIdentity?.activeLeafId).not.toBeNull()
    await expect
      .poll(() => getTerminalContent(mantaPage, 6_000), { timeout: 20_000 })
      .toContain('CHILD_TUI_FRAME')
    await expect
      .poll(async () => {
        const match = (await getTerminalContent(mantaPage, 6_000)).match(/CHILD_TUI_PID_(\d+)/)
        return match?.[1] ?? null
      })
      .not.toBeNull()
    const childPid = (await getTerminalContent(mantaPage, 6_000)).match(/CHILD_TUI_PID_(\d+)/)?.[1]
    expect(childPid).toBeDefined()
    await activateTerminalTab(mantaPage, shellTabId)
    const shellPtyId = await waitForActivePanePtyId(mantaPage, 30_000)
    const exitSignal = exitMode === 'normal' ? 'SIGTERM' : 'SIGKILL'
    const killCommand = stageNodeScriptForTerminal(`process.kill(${childPid!}, '${exitSignal}')`, {
      prefix: 'orca-child-tui-external-kill'
    }).command
    await execInTerminal(mantaPage, shellPtyId, killCommand)
    await expect
      .poll(
        () =>
          mantaPage.evaluate(async (ptyId) => {
            const processName = await window.api.pty.getForegroundProcess(ptyId)
            return processName?.toLowerCase() ?? null
          }, tuiPtyId),
        { timeout: 8_000 }
      )
      .toMatch(/^(bash|zsh|sh|fish)(\.exe)?$/)
    await mantaPage.evaluate(
      ({ paneKey, tabId }) => {
        const state = window.__store?.getState()
        const worktreeId = state?.activeWorktreeId
        if (!state || !worktreeId) {
          throw new Error('store/worktree unavailable')
        }
        state.setAgentStatus(
          paneKey,
          { state: 'working', prompt: 'stale hidden TUI status', agentType: 'codex' },
          'Codex',
          undefined,
          { tabId, worktreeId }
        )
      },
      { paneKey: `${tuiTabId}:${tuiIdentity!.activeLeafId!}`, tabId: tuiTabId }
    )
    await clearTerminalPtyWriteLog(electronApp)
    await activateTerminalTab(mantaPage, tuiTabId)

    const revealedPtyId = await mantaPage.evaluate((tabId) => {
      const manager = window.__paneManagers?.get(tabId)
      return manager?.getActivePane?.()?.container?.dataset?.ptyId ?? null
    }, tuiTabId)
    expect(revealedPtyId).not.toBeNull()
    await expect
      .poll(async () => {
        const snapshot = await mantaPage.evaluate(
          (ptyId) => window.api.pty.getMainBufferSnapshot(ptyId, { scrollbackRows: 5000 }),
          revealedPtyId!
        )
        return snapshot?.terminalOwner === 'shell' && snapshot.alternateScreen === false
      })
      .toBe(true)
    await expect
      .poll(() =>
        mantaPage.evaluate((tabId) => {
          const manager = window.__paneManagers?.get(tabId)
          const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
          return {
            buffer: pane?.terminal.buffer.active.type,
            mouse: pane?.terminal.modes.mouseTrackingMode
          }
        }, tuiTabId)
      )
      .toEqual({ buffer: 'normal', mouse: 'none' })

    // Why normal-exit only: the barrier preserves shell output from the 133;D
    // boundary onward (the prompt), but bytes the dying command printed while
    // the alternate screen was still up are part of the discarded dead frame.
    // On SIGKILL the parent's exit line lands pre-D in the alt buffer, so it is
    // unrecoverable by design; on normal exit the child's own ?1049l precedes
    // it and it survives on the normal buffer.
    if (exitMode === 'normal') {
      await expect
        .poll(() => getTerminalContent(mantaPage, 6_000), { timeout: 8_000 })
        .toContain('CHILD_TUI_KILLED')
    }

    const shellInputMarker = 'SHELL_INPUT_AFTER_TUI_KILL'
    await execInTerminal(mantaPage, revealedPtyId!, `printf ${shellInputMarker}`)
    await expect
      .poll(async () => {
        const writes = await readTerminalPtyWriteEntries(electronApp)
        return writes.some(
          (entry) => entry.id === revealedPtyId && entry.data.includes(shellInputMarker)
        )
      })
      .toBe(true)
    await expect
      .poll(() => getTerminalContent(mantaPage, 6_000), { timeout: 8_000 })
      .toContain(shellInputMarker)

    const terminalScreen = mantaPage.locator(`[data-pty-id="${revealedPtyId}"] .xterm-screen`)
    await terminalScreen.hover({ position: { x: 20, y: 20 } })
    await mantaPage.mouse.wheel(0, 120)
    await mantaPage.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )

    const ptyWrites = (await readTerminalPtyWriteEntries(electronApp))
      .filter((entry) => entry.id === revealedPtyId)
      .map((entry) => entry.data)
    const escape = String.fromCharCode(27)
    expect(ptyWrites.some((data) => data.includes(`${escape}[<`))).toBe(false)
    expect(ptyWrites.some((data) => data.includes(`${escape}[M`))).toBe(false)

    const terminalState = await mantaPage.evaluate((tabId) => {
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
      return {
        buffer: pane?.terminal.buffer.active.type,
        mouse: pane?.terminal.modes.mouseTrackingMode
      }
    }, tuiTabId)
    expect(terminalState).toEqual({ buffer: 'normal', mouse: 'none' })
    expect(await getTerminalContent(mantaPage, 6_000)).not.toMatch(/\[<\d+;\d+;\d+[Mm]/)

    await activateTerminalTab(mantaPage, shellTabId)
    expect(await waitForActivePanePtyId(mantaPage, 30_000)).toBe(shellPtyId)
    const unrelatedMarker = 'UNRELATED_SHELL_STILL_LIVE'
    await execInTerminal(mantaPage, shellPtyId, `printf ${unrelatedMarker}`)
    await expect
      .poll(() => getTerminalContent(mantaPage, 6_000), { timeout: 8_000 })
      .toContain(unrelatedMarker)
  })
}
