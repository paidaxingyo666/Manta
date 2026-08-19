import type { Page } from '@stablyai/playwright-test'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/manta-app'
import {
  focusActiveTerminalInput,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput,
  sendToTerminal
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const KEY_LATENCY_SAMPLES = 'abcdefghijklmnop'
const MAX_MEDIAN_KEY_LATENCY_MS = 250
const MAX_WORST_KEY_LATENCY_MS = 1_000

function interactivePromptScript(runId: string): string {
  return `
process.stdin.setEncoding('utf8')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
let seq = 0
const interrupt = String.fromCharCode(3)
process.stdout.write('\\x1b]0;Terminal typing benchmark\\x07')
process.stdout.write('TYPING_READY_${runId}\\n')
process.stdin.on('data', (chunk) => {
  if (chunk.includes(interrupt)) {
    process.exit(0)
  }
  for (const char of chunk) {
    if (char === '\\r' || char === '\\n') continue
    seq += 1
    process.stdout.write('\\r\\x1b[2KInteractive prompt ' + seq + ': ' + char + ' TYPING_KEY_${runId}_' + seq + '\\n')
  }
})
`
}

async function waitForMarkerLatency(
  page: Page,
  marker: string,
  timeoutMs: number
): Promise<number> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if ((await getTerminalContent(page, 12_000)).includes(marker)) {
      return performance.now() - start
    }
    await page.waitForTimeout(5)
  }
  throw new Error(`Timed out waiting for terminal marker ${marker}`)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

test.describe('Terminal typing latency', () => {
  test('interactive prompt echoes typed keys without visible lag', async ({
    mantaPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
    await ensureTerminalVisible(mantaPage)
    await waitForActiveTerminalManager(mantaPage, 30_000)

    const ptyId = await waitForActivePanePtyId(mantaPage)
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.manta-typing-benchmark-${runId}.mjs`)
    writeFileSync(scriptPath, interactivePromptScript(runId))
    let commandSent = false
    try {
      await sendToTerminal(mantaPage, ptyId, `node ${JSON.stringify(scriptPath)}\r`)
      commandSent = true
      await waitForTerminalOutput(mantaPage, `TYPING_READY_${runId}`, 10_000)
      await focusActiveTerminalInput(mantaPage)

      const latencies: number[] = []
      for (const [index, char] of [...KEY_LATENCY_SAMPLES].entries()) {
        const seq = index + 1
        const marker = `TYPING_KEY_${runId}_${seq}`
        const start = performance.now()
        await mantaPage.keyboard.type(char)
        await waitForMarkerLatency(mantaPage, marker, MAX_WORST_KEY_LATENCY_MS)
        latencies.push(performance.now() - start)
      }

      const medianLatency = median(latencies)
      const worstLatency = Math.max(...latencies)
      testInfo.annotations.push({
        type: 'terminal-typing-latency',
        description: `median=${medianLatency.toFixed(1)}ms worst=${worstLatency.toFixed(1)}ms samples=${latencies
          .map((value) => value.toFixed(1))
          .join(',')}`
      })

      expect(medianLatency).toBeLessThan(MAX_MEDIAN_KEY_LATENCY_MS)
      expect(worstLatency).toBeLessThan(MAX_WORST_KEY_LATENCY_MS)
    } finally {
      if (commandSent) {
        await sendToTerminal(mantaPage, ptyId, '\x03').catch(() => undefined)
      }
      rmSync(scriptPath, { force: true })
    }
  })
})
