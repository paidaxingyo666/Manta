import { expect, test } from './helpers/manta-app'
import {
  connectDockerSshRelayTarget,
  reconnectDockerSshRelayTarget
} from './helpers/docker-ssh-relay-connection'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetControlCommand,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget,
  writeDockerSshRelayTargetFile
} from './helpers/docker-ssh-relay-target'
import {
  bashExecProfileContents,
  closeStartupExecTerminal,
  createStartupExecTerminal,
  expectStartupCommandQueuedByCompatibilityFallback,
  expectStartupExecRecovery
} from './helpers/startup-exec-readiness-oracle'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActiveTerminalManager } from './helpers/terminal'

const RUN_DOCKER_SSH = process.env.MANTA_E2E_SSH_DOCKER === '1'

test.describe('startup exec readiness over live SSH', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set MANTA_E2E_SSH_DOCKER=1 to run Docker-backed SSH E2E.')
  test.skip(process.platform === 'win32', 'Docker SSH E2E uses POSIX ssh tooling.')

  test('survives an SSH reconnect while the replacement shell is not ready @headful', async ({
    mantaPage
  }, testInfo) => {
    test.setTimeout(150_000)
    const runId = `ssh_${Date.now()}`
    const startedPath = `/tmp/sta4067-${runId}.started`
    const releasePath = `/tmp/sta4067-${runId}.release`
    const ledgerPath = `/tmp/sta4067-${runId}.ledger`
    let target: DockerSshRelayTarget | null = null
    let terminal: string | null = null
    try {
      target = startDockerSshRelayTarget(testInfo)
      await waitForSessionReady(mantaPage)
      await waitForActiveWorktree(mantaPage)
      const remote = await connectDockerSshRelayTarget(mantaPage, target, {
        relayGracePeriodSeconds: 15
      })
      await ensureTerminalVisible(mantaPage, 45_000)
      await waitForActiveTerminalManager(mantaPage, 60_000)
      writeDockerSshRelayTargetFile(
        target,
        '/root/.bash_profile',
        bashExecProfileContents(runId, { releasePath, startedPath })
      )
      const created = await createStartupExecTerminal(
        mantaPage,
        remote.worktreeId,
        runId,
        ledgerPath,
        'owning-client'
      )
      terminal = created.terminal
      await expect
        .poll(
          () =>
            execDockerSshRelayTargetControlCommand(
              target!,
              `if test -e '${startedPath}'; then echo ready; else echo pending; fi`
            ),
          { timeout: 30_000 }
        )
        .toBe('ready')
      await expectStartupCommandQueuedByCompatibilityFallback(mantaPage, created)
      expect(
        execDockerSshRelayTargetControlCommand(
          target,
          `if test ! -e '${ledgerPath}'; then echo pending; else cat '${ledgerPath}'; fi`
        )
      ).toBe('pending')

      await reconnectDockerSshRelayTarget(mantaPage, remote.targetId)
      execDockerSshRelayTargetControlCommand(target, `: > '${releasePath}'`)
      await expect
        .poll(
          () =>
            execDockerSshRelayTargetControlCommand(
              target!,
              `if test -e '${ledgerPath}'; then cat '${ledgerPath}'; else echo pending; fi`
            ),
          { timeout: 8_000 }
        )
        .toMatch(/^[0-9]+\|\/dev\/pts\/[0-9]+$/)
      await expectStartupExecRecovery(mantaPage, created, runId)

      const [pidText, tty] = execDockerSshRelayTargetControlCommand(
        target,
        `cat '${ledgerPath}'`
      ).split('|')
      const pid = Number(pidText)
      expect(pid).toBeGreaterThan(1)
      expect(tty).toMatch(/^\/dev\/pts\/[0-9]+$/)
      expect(execDockerSshRelayTargetControlCommand(target, `readlink '/proc/${pid}/exe'`)).toMatch(
        /\/bash$/
      )
      expect(
        execDockerSshRelayTargetControlCommand(target, `ps -o tpgid= -p '${pid}' | tr -d ' '`)
      ).toBe(String(pid))
    } finally {
      await closeStartupExecTerminal(mantaPage, terminal)
      cleanupDockerSshRelayTarget(target)
    }
  })
})
