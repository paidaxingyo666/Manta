import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/manta-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import {
  enableNativeChatSetting,
  seedClaudeProviderSession,
  toggleTerminalTabToChatView,
  claudeTranscriptLines
} from './helpers/native-chat-transcript-fixture'

const LOADING_TITLE = 'Loading conversation…'
const ERROR_TITLE = 'Could not load conversation'

test.describe('Native chat first-flush transcript race (#8401)', () => {
  test('stays in loading (never errors) until a not-yet-flushed transcript appears, then hydrates live', async ({
    mantaPage
  }, testInfo) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
    await ensureTerminalVisible(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)

    const descriptor = await waitForActivePaneHookDescriptor(mantaPage)
    const [tabId] = descriptor.paneKey.split(':')
    const sessionId = `e2e-first-flush-${randomUUID()}`

    // Why: a real Claude Code session flushes its first JSONL line up to
    // minutes after launch (#8401) — this directory intentionally has no file
    // yet when the pane resolves its providerSession.
    const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'manta-e2e-native-chat-'))
    const transcriptPath = path.join(scratchDir, `${sessionId}.jsonl`)

    const screenshotDir = testInfo.outputPath('screenshots')
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })

    try {
      await enableNativeChatSetting(mantaPage)
      await seedClaudeProviderSession(mantaPage, {
        paneKey: descriptor.paneKey,
        worktreeId: descriptor.worktreeId,
        sessionId,
        transcriptPath
      })
      await toggleTerminalTabToChatView(mantaPage, { tabId, worktreeId: descriptor.worktreeId })

      await expect(mantaPage.locator('[data-native-chat-root="true"]')).toBeVisible({
        timeout: 15_000
      })
      await expect(mantaPage.getByText(LOADING_TITLE)).toBeVisible({ timeout: 10_000 })
      await expect(mantaPage.getByText(ERROR_TITLE)).toHaveCount(0)
      await mantaPage.screenshot({
        path: path.join(screenshotDir, '01-loading-no-error.png')
      })

      // Why observe, not sleep: 1_500ms is exactly UNFLUSHED_SETTLE_MS, so a fixed
      // wait straddles the boundary where the host reports the transcript pending
      // and the renderer cancels its own retry. Read through the same IPC instead,
      // proving the miss directly. A notFound is never cached, so this cannot
      // perturb the hydration the assertions below measure.
      await expect
        .poll(
          () =>
            mantaPage.evaluate(
              ({ id, file }) =>
                window.api.nativeChat
                  .readSession('claude', id, 50, file)
                  .then((result) => Boolean(result && 'error' in result && result.notFound)),
              { id: sessionId, file: transcriptPath }
            ),
          { timeout: 10_000, message: 'transcript resolved before the first flush' }
        )
        .toBe(true)
      await expect(mantaPage.getByText(ERROR_TITLE)).toHaveCount(0)

      const userText = 'Explain the native chat first-flush race fix for #8401'
      const assistantText =
        'The main process now retries a not-yet-flushed transcript instead of caching a permanent miss.'
      writeFileSync(transcriptPath, claudeTranscriptLines({ sessionId, userText, assistantText }))

      // Why: the user text also surfaces as chrome (worktree row, tab
      // title), so scope hydration assertions to the transcript subtree.
      const transcript = mantaPage.locator('[data-native-chat-root="true"]')
      await expect(transcript.getByText(userText)).toBeVisible({ timeout: 30_000 })
      await expect(transcript.getByText(assistantText)).toBeVisible({ timeout: 30_000 })
      await expect(mantaPage.getByText(ERROR_TITLE)).toHaveCount(0)
      await mantaPage.screenshot({
        path: path.join(screenshotDir, '02-hydrated.png')
      })
    } finally {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  })
})
