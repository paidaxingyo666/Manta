import { test } from './helpers/manta-app'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedWebClient
} from './helpers/paired-electron-client'
import { runPairedTerminalParkingOracle } from './helpers/paired-terminal-parking-oracle'

test('ordinary-parks paired terminals and restores authoritative host scrollback @headful', async ({
  electronApp,
  mantaPage
}) => {
  test.setTimeout(240_000)
  const seed = await mantaPage.evaluate(() => {
    const state = window.__store?.getState()
    const worktrees = state?.allWorktrees() ?? []
    const active = worktrees.find((worktree) => worktree.id === state?.activeWorktreeId)
    if (!active) {
      throw new Error('Paired retention host has no active seeded worktree')
    }
    return { activeWorktreeId: active.id, repoId: active.repoId }
  })
  const offer = await createRuntimeDesktopPairingOffer(mantaPage)
  const client = await launchPairedWebClient(electronApp, offer, {
    terminalParkingDelayMs: 100
  })
  try {
    await runPairedTerminalParkingOracle(
      client.page,
      {
        fallbackWorktreeId: seed.activeWorktreeId,
        repoId: seed.repoId
      },
      { hostPage: mantaPage }
    )
  } finally {
    await client.dispose()
  }
})
