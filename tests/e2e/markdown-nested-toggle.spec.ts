import { readFileSync } from 'node:fs'
import { test, expect } from './helpers/manta-app'
import {
  cleanupMarkdownFixture,
  closeActiveEditorTab,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'
import {
  expectEditableNestedToggles,
  expectFileKeepsNesting,
  expectPassthroughFallback,
  expectSentinelInsideNestedToggle,
  NESTED_TOGGLE_FIXTURE_DIRECTORY,
  NESTED_TOGGLE_MARKDOWN,
  placeCaretInNestedToggleBody,
  UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
} from './helpers/markdown-nested-toggle'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.describe('Markdown nested toggle regression', () => {
  test.beforeEach(async ({ mantaPage }) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
  })

  test('a nested toggle on disk reopens as editable toggles', async ({ mantaPage }, testInfo) => {
    const context = await getActiveWorktreeContext(mantaPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-reopen',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(mantaPage, context, filePath)
      await waitForRichMarkdownEditor(mantaPage)

      await expectEditableNestedToggles(mantaPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('editing a nested toggle survives save and reopen', async ({ mantaPage }, testInfo) => {
    const context = await getActiveWorktreeContext(mantaPage)
    const sentinel = `editedInsideNestedToggle${Date.now()}`
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-edit',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(mantaPage, context, filePath)
      await waitForRichMarkdownEditor(mantaPage)
      await expectEditableNestedToggles(mantaPage)

      await placeCaretInNestedToggleBody(mantaPage)
      await mantaPage.keyboard.type(` ${sentinel}`)
      await expectSentinelInsideNestedToggle(mantaPage, sentinel)

      // Save through the real shortcut and assert the bytes that landed on disk.
      await mantaPage.keyboard.press('ControlOrMeta+S')
      const savedPath = filePath
      await expect
        .poll(() => readFileSync(savedPath, 'utf8'), { timeout: 10_000 })
        .toContain(sentinel)
      expectFileKeepsNesting(readFileSync(savedPath, 'utf8'), sentinel)

      // The reported bug only appeared on reopen, so close the tab and parse
      // the saved file again from scratch.
      await closeActiveEditorTab(mantaPage, savedPath)
      await openMarkdownFixture(mantaPage, context, savedPath)
      await waitForRichMarkdownEditor(mantaPage)
      await expectEditableNestedToggles(mantaPage)
      await expectSentinelInsideNestedToggle(mantaPage, sentinel)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a nested toggle that cannot be represented stays raw passthrough', async ({
    mantaPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(mantaPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-unsupported',
        testInfo.workerIndex,
        UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(mantaPage, context, filePath)
      await waitForRichMarkdownEditor(mantaPage)

      await expectPassthroughFallback(mantaPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
