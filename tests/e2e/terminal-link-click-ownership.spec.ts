import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { test, expect } from './helpers/manta-app'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const FIXTURE_PATH = path.join(
  process.cwd(),
  'tests/e2e/fixtures/terminal-link-mouse-owner-fixture.cjs'
)
const LINK = 'https://example.com/sta-3888'
const OSC_LINK_TEXT = 'STA_3888_OSC_LINK'

type LinkTarget = { x: number; y: number; mouseTrackingMode: string }
type LinkMode = 'http' | 'osc'

async function startMouseAwareLinkFixture(
  mantaPage: Page,
  testInfo: TestInfo,
  linkMode: LinkMode = 'http'
): Promise<{ mouseLogPath: string; ptyId: string; target: LinkTarget }> {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await waitForActiveTerminalManager(mantaPage)
  await waitForPaneCount(mantaPage, 1)

  const ptyId = await waitForActivePanePtyId(mantaPage)
  const mouseLogPath = testInfo.outputPath('child-mouse-reports.log')
  await execInTerminal(
    mantaPage,
    ptyId,
    `node ${JSON.stringify(FIXTURE_PATH)} ${JSON.stringify(mouseLogPath)} ${linkMode}`
  )
  const renderedLinkText = linkMode === 'osc' ? OSC_LINK_TEXT : LINK
  await waitForTerminalOutput(mantaPage, 'LINK_MOUSE_READY')

  const target = await mantaPage.evaluate((linkText) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId = worktreeId ? state?.activeTabIdByWorktree?.[worktreeId] : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null
    if (!pane || !screen) {
      throw new Error('Active terminal screen unavailable')
    }

    const buffer = pane.terminal.buffer.active
    for (let viewportRow = 0; viewportRow < pane.terminal.rows; viewportRow += 1) {
      const text = buffer.getLine(buffer.viewportY + viewportRow)?.translateToString(false)
      const column = text?.indexOf(linkText) ?? -1
      if (column < 0) {
        continue
      }
      const rect = screen.getBoundingClientRect()
      const cell = pane.terminal.dimensions?.css.cell
      if (!cell?.width || !cell.height) {
        throw new Error('Active terminal cell dimensions unavailable')
      }
      return {
        x: rect.left + (column + linkText.length / 2) * cell.width,
        y: rect.top + (viewportRow + 0.5) * cell.height,
        mouseTrackingMode: pane.terminal.modes.mouseTrackingMode
      }
    }
    throw new Error('Rendered fixture link unavailable')
  }, renderedLinkText)

  expect(target.mouseTrackingMode).not.toBe('none')
  return { mouseLogPath, ptyId, target }
}

function childMouseReportCount(mouseLogPath: string): number {
  if (!existsSync(mouseLogPath)) {
    return 0
  }
  return readFileSync(mouseLogPath, 'utf8').trim().split(/\s+/).filter(Boolean).length
}

async function expectChildMouseReports(mouseLogPath: string): Promise<void> {
  await expect
    .poll(() => childMouseReportCount(mouseLogPath), { timeout: 5_000 })
    .toBeGreaterThan(0)
}

async function expectMantaOwnedMouseOutcome(mouseLogPath: string): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
  expect(childMouseReportCount(mouseLogPath)).toBe(0)
}

test.describe('terminal link click ownership', () => {
  test('a Manta-owned plain link click emits no child PTY mouse frames', async ({
    mantaPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(mantaPage, testInfo)
    await mantaPage.mouse.click(target.x, target.y)

    await expect(mantaPage.locator('[data-terminal-link-action-popover]')).toBeVisible()
    await expect(mantaPage.locator('[data-terminal-link-destination]')).toHaveText(LINK)

    await expectMantaOwnedMouseOutcome(mouseLogPath)

    await sendToTerminal(mantaPage, ptyId, 'q')
  })

  test('a Manta-owned OSC link click emits no child PTY mouse frames', async ({
    mantaPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(
      mantaPage,
      testInfo,
      'osc'
    )
    await mantaPage.mouse.move(target.x, target.y)
    await expect(mantaPage.locator('.xterm-hover')).toHaveCount(1)
    await mantaPage.mouse.click(target.x, target.y)

    await expect(mantaPage.locator('[data-terminal-link-action-popover]')).toBeVisible()
    await expect(mantaPage.locator('[data-terminal-link-destination]')).toHaveText(LINK)
    await expectMantaOwnedMouseOutcome(mouseLogPath)

    await sendToTerminal(mantaPage, ptyId, 'q')
  })

  test('a plain click stays child-owned when link actions are disabled', async ({
    mantaPage
  }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(mantaPage, testInfo)
    await mantaPage.evaluate(async () => {
      await window.__store?.getState().updateSettings({ terminalLinkActionPopoverEnabled: false })
    })

    await mantaPage.mouse.click(target.x, target.y)

    await expect(mantaPage.locator('[data-terminal-link-action-popover]')).toHaveCount(0)
    await expectChildMouseReports(mouseLogPath)
    await sendToTerminal(mantaPage, ptyId, 'q')
  })

  test('a drag across a link stays child-owned', async ({ mantaPage }, testInfo) => {
    const { mouseLogPath, ptyId, target } = await startMouseAwareLinkFixture(mantaPage, testInfo)

    await mantaPage.mouse.move(target.x, target.y)
    await mantaPage.mouse.down()
    await mantaPage.mouse.move(target.x + 12, target.y + 12, { steps: 3 })
    await mantaPage.mouse.up()

    await expect(mantaPage.locator('[data-terminal-link-action-popover]')).toHaveCount(0)
    await expectChildMouseReports(mouseLogPath)
    await sendToTerminal(mantaPage, ptyId, 'q')
  })
})
