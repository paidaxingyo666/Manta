import { test, expect } from './helpers/manta-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture
} from './helpers/markdown-editor-fixture'

test('source links stay outside mixed code fences', async ({ mantaPage }, testInfo) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  const context = await getActiveWorktreeContext(mantaPage)
  const file = await createMarkdownFixture(
    context,
    'markdown-fences',
    'links',
    testInfo.workerIndex,
    '# Fence boundaries\n\n~~~text\n```\n[[inside-code]]\n~~~\n\n[[outside-code]]\n'
  )
  try {
    await openMarkdownFixture(mantaPage, context, file)
    await mantaPage.evaluate(() => {
      const state = window.__store!.getState()
      if (!state.activeFileId) {
        throw new Error('missing active file')
      }
      state.setMarkdownViewMode(state.activeFileId, 'source')
    })
    const links = mantaPage.locator('.monaco-editor .view-line').filter({
      has: mantaPage.locator('.monaco-markdown-doc-link')
    })
    await expect(links).toHaveCount(1)
    await expect(links).toHaveText('[[outside-code]]')
    await testInfo.attach('fence-links', {
      body: await mantaPage.screenshot({ path: testInfo.outputPath('fence-links.png') }),
      contentType: 'image/png'
    })
  } finally {
    await cleanupMarkdownFixture(file)
  }
})
