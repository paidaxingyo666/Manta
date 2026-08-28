import { test, expect } from './helpers/manta-app'
import {
  execInTerminal,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type CodexHomeProbe = {
  codexHome: string | null
  mantaCodexHome: string | null
}

function readCodexHomeProbe(pageContent: string, marker: string): CodexHomeProbe | null {
  const match = new RegExp(`${marker}:(\\{[^\\r\\n]+\\})`).exec(pageContent)
  if (!match) {
    return null
  }
  return JSON.parse(match[1] ?? 'null') as CodexHomeProbe | null
}

test.describe('Terminal Codex runtime home', () => {
  test.beforeEach(async ({ mantaPage }) => {
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)
    await ensureTerminalVisible(mantaPage)
  })

  test('terminal process receives the Manta-managed Codex home', async ({ mantaPage }) => {
    await waitForActiveTerminalManager(mantaPage)
    const ptyId = await waitForActivePanePtyId(mantaPage)
    const marker = `__MANTA_CODEX_HOME_E2E_${Date.now()}__`
    const command = [
      'node -e',
      `"console.log('${marker}:' + JSON.stringify({codexHome: process.env.CODEX_HOME || null, mantaCodexHome: process.env.MANTA_CODEX_HOME || null}))"`
    ].join(' ')

    await execInTerminal(mantaPage, ptyId, command)

    let probe: CodexHomeProbe | null = null
    await expect
      .poll(
        async () => {
          probe = readCodexHomeProbe(await getTerminalContent(mantaPage), marker)
          return Boolean(
            probe?.codexHome &&
            probe.mantaCodexHome &&
            probe.codexHome === probe.mantaCodexHome &&
            /[\\/]codex-runtime-home[\\/]home$/.test(probe.codexHome)
          )
        },
        { timeout: 15_000, message: 'Terminal did not expose Manta-managed Codex home env' }
      )
      .toBe(true)

    expect(probe?.codexHome).toBe(probe?.mantaCodexHome)
  })
})
