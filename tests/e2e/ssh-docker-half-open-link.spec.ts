/**
 * Half-open SSH link probe.
 *
 * Freezes the remote host with `docker pause`. The container's TCP stack keeps
 * ACKing, so the socket never sees a FIN or an RST — only the application stops
 * answering. That is the wedge shape #17817 and #17838 are about: a link that
 * looks perfectly healthy to TCP and can only be judged by an application probe.
 *
 * Requires: MANTA_E2E_SSH_DOCKER=1 and Docker available.
 */
import { execFileSync } from 'node:child_process'
import { expect, test } from './helpers/manta-app'
import {
  cleanupDockerSshRelayTarget,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

const RUN_DOCKER_SSH = process.env.MANTA_E2E_SSH_DOCKER === '1'
/** Generous: the point is that a verdict arrives at all, not its exact latency. */
const LOST_VERDICT_BUDGET_MS = 90_000

function docker(args: string[]): void {
  execFileSync('docker', args, { timeout: 30_000 })
}

async function readSshStatus(
  page: Parameters<typeof waitForActivePanePtyId>[0],
  targetId: string
): Promise<string | null> {
  return page.evaluate(
    (id) => window.__store?.getState().sshConnectionStates.get(id)?.status ?? null,
    targetId
  )
}

test.describe('Docker SSH half-open link', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set MANTA_E2E_SSH_DOCKER=1 to run Docker-backed SSH tests.')
  test.skip(process.platform === 'win32', 'Uses docker pause against a Linux container.')

  test('declares a frozen host lost instead of wedging, and recovers @half-open', async ({
    mantaPage,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    test.setTimeout(420_000)
    let target: DockerSshRelayTarget | null = null
    let paused = false
    try {
      target = startDockerSshRelayTarget(testInfo)
      const captured = target
      registerPostElectronShutdownCleanup(async () => {
        cleanupDockerSshRelayTarget(captured)
      })

      await waitForSessionReady(mantaPage)
      await waitForActiveWorktree(mantaPage)
      const remote = await connectDockerSshRelayTarget(mantaPage, target)
      await ensureTerminalVisible(mantaPage, 45_000)
      await waitForActiveTerminalManager(mantaPage, 60_000)
      const ptyId = await waitForActivePanePtyId(mantaPage, 60_000)

      const runId = String(Date.now())
      await execInTerminal(mantaPage, ptyId, `echo LIVE_${runId}`)
      await waitForTerminalOutput(mantaPage, `LIVE_${runId}`, 60_000)
      expect(await readSshStatus(mantaPage, remote.targetId)).toBe('connected')

      // Freeze the host: TCP keeps ACKing, the application stops answering.
      docker(['pause', target.containerName])
      paused = true
      const frozenAt = Date.now()

      let verdict: string | null = 'connected'
      while (Date.now() - frozenAt < LOST_VERDICT_BUDGET_MS) {
        verdict = await readSshStatus(mantaPage, remote.targetId)
        if (verdict !== 'connected') {
          break
        }
        await mantaPage.waitForTimeout(1_000)
      }
      const verdictMs = Date.now() - frozenAt
      console.log(
        `[half-open] ${JSON.stringify({ verdict, verdictMs, budgetMs: LOST_VERDICT_BUDGET_MS })}`
      )

      docker(['unpause', target.containerName])
      paused = false

      // Why this is the assertion: a wedged client sits on `connected` forever and
      // never offers the user a reconnect. Any non-connected verdict is a pass.
      expect(
        verdict,
        `client never left "connected" ${verdictMs}ms after the host was frozen`
      ).not.toBe('connected')

      // The link must be usable again once the host thaws.
      await expect
        .poll(() => readSshStatus(mantaPage, remote.targetId), { timeout: 120_000 })
        .toBe('connected')
      const recoveredPtyId = await waitForActivePanePtyId(mantaPage, 60_000)
      await execInTerminal(mantaPage, recoveredPtyId, `echo RECOVERED_${runId}`)
      await waitForTerminalOutput(mantaPage, `RECOVERED_${runId}`, 90_000)
    } finally {
      if (target && paused) {
        try {
          docker(['unpause', target.containerName])
        } catch {
          // The container may already be gone; cleanup below is authoritative.
        }
      }
      if (target) {
        cleanupDockerSshRelayTarget(target)
      }
    }
  })
})
