import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/manta-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const DRAFT_LINE = 6
const FOLLOWING_LINE = 'export const line07 = "draft-following-line-marker"'
const NOTE_BODY = 'This note was added from the inline draft card.'

async function attachDiffScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const screenshotPath = testInfo.outputPath(`${name}.png`)
  await page.locator('.monaco-diff-editor').first().screenshot({ path: screenshotPath })
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
}

test.describe('Diff note draft', () => {
  test.beforeEach(async ({ mantaPage }) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
  })

  test('opens an inline draft without overlapping code and saves it', async ({
    mantaPage
  }, testInfo) => {
    await mantaPage.setViewportSize({ width: 1200, height: 800 })
    const worktreeId = await waitForActiveWorktree(mantaPage)
    const relativePath = await mantaPage.evaluate(async (wId) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      const worktree = Object.values(state.worktreesByRepo)
        .flat()
        .find((entry) => entry.id === wId)
      if (!worktree) {
        throw new Error('active worktree not found')
      }
      const separator = worktree.path.includes('\\') ? '\\' : '/'
      const relative = `src${separator}diff-note-draft.ts`
      const lines = Array.from({ length: 14 }, (_, index) => {
        const number = String(index + 1).padStart(2, '0')
        const value = index + 1 === 7 ? 'draft-following-line-marker' : `value-${number}`
        return `export const line${number} = "${value}"`
      })
      await window.api.fs.writeFile({
        filePath: `${worktree.path}${separator}${relative}`,
        content: `${lines.join('\n')}\n`
      })
      await state.updateSettings({ diffDefaultView: 'side-by-side' })
      state.openDiff(wId, `${worktree.path}${separator}${relative}`, relative, 'typescript', false)
      return relative
    }, worktreeId)

    const followingLine = mantaPage
      .locator('.modified-in-monaco-diff-editor .view-lines .view-line')
      .filter({ hasText: FOLLOWING_LINE })
      .first()
    await expect(followingLine).toBeVisible({ timeout: 15_000 })
    // Let the filesystem watcher finish its model refresh before opening a draft in that model.
    await mantaPage.waitForTimeout(3_000)

    const draftLine = mantaPage
      .locator('.modified-in-monaco-diff-editor .view-lines .view-line')
      .filter({ hasText: `export const line${String(DRAFT_LINE).padStart(2, '0')} = "value-06"` })
      .first()
    await draftLine.hover({ position: { x: 4, y: 8 } })
    const addButton = mantaPage.locator('.manta-diff-comment-add-btn')
    await expect(addButton).toBeVisible()
    await addButton.click()

    const draftCard = mantaPage.locator('.manta-diff-comment-draft-card')
    const textarea = draftCard.locator('textarea')
    await expect(draftCard).toBeVisible({ timeout: 15_000 })
    await expect(draftCard).toContainText('Line 6')
    await expect(draftCard).not.toContainText('You')
    await expect
      .poll(() => textarea.evaluate((element) => document.activeElement === element))
      .toBe(true)
    await expect(mantaPage.locator('.manta-diff-comment-draft-margin')).toBeVisible()
    await expect
      .poll(
        async () => {
          const [cardBox, lineBox] = await Promise.all([
            draftCard.boundingBox(),
            followingLine.boundingBox()
          ])
          return cardBox && lineBox ? lineBox.y - (cardBox.y + cardBox.height) : -1
        },
        { message: 'inline draft overlaps the following diff line' }
      )
      .toBeGreaterThanOrEqual(0)
    await attachDiffScreenshot(mantaPage, testInfo, 'inline-diff-note-draft')

    await textarea.fill(NOTE_BODY)
    const submitButton = draftCard.locator('button').filter({ hasText: /add note/i })
    await expect(submitButton).toBeEnabled()
    await submitButton.click()
    await expect(draftCard).toBeHidden()
    const savedCard = mantaPage
      .locator('.manta-diff-comment-card')
      .filter({ hasText: NOTE_BODY })
      .first()
    await expect(savedCard).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(
        async () =>
          await mantaPage.evaluate(
            ({ wId, filePath, body }) => {
              const comments = window.__store?.getState().getDiffComments(wId) ?? []
              return comments.some(
                (comment) => comment.filePath === filePath && comment.body === body
              )
            },
            { wId: worktreeId, filePath: relativePath, body: NOTE_BODY }
          )
      )
      .toBe(true)
    await attachDiffScreenshot(mantaPage, testInfo, 'saved-inline-diff-note')
  })
})
