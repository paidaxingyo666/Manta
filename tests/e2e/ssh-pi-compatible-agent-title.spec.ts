import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/manta-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import {
  cleanupDockerSshRelayTarget,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'

const RUN_DOCKER_SSH = process.env.MANTA_E2E_SSH_DOCKER === '1'

type RuntimeTerminalStatus = {
  isRunningAgent: boolean
  status: string | null
}

type RuntimeTerminalSummary = {
  handle: string
  ptyId: string | null
  title: string | null
}

async function emitOscTitle(page: Page, ptyId: string, title: string): Promise<void> {
  await sendToTerminal(page, ptyId, `printf '\\033]0;${title}\\007'\r`)
}

async function findTerminalByPtyId(page: Page, ptyId: string): Promise<string> {
  return page.evaluate(async (ptyId) => {
    const response = await window.api.runtime.call({
      method: 'terminal.list',
      params: { limit: 50 }
    })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    const terminals = (response.result as { terminals: RuntimeTerminalSummary[] }).terminals
    const terminal = terminals.find((candidate) => candidate.ptyId === ptyId)
    if (!terminal) {
      throw new Error(
        `No runtime terminal for PTY ${ptyId}; terminals=${JSON.stringify(terminals)}`
      )
    }
    return terminal.handle
  }, ptyId)
}

async function readTerminalAgentStatus(
  page: Page,
  terminalHandle: string
): Promise<RuntimeTerminalStatus> {
  return page.evaluate(async (terminal) => {
    const response = await window.api.runtime.call({
      method: 'terminal.agentStatus',
      params: { terminal }
    })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return (response.result as { agentStatus: RuntimeTerminalStatus }).agentStatus
  }, terminalHandle)
}

test.describe('Docker SSH Pi-compatible agent titles', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set MANTA_E2E_SSH_DOCKER=1 to run Docker-backed SSH relay tests.')
  test.skip(process.platform === 'win32', 'Docker SSH relay tests use POSIX ssh tooling.')

  test('classifies OMP and Pi title transitions from a remote terminal', async ({
    mantaPage
  }, testInfo) => {
    test.slow()
    let target: DockerSshRelayTarget | null = null
    try {
      target = startDockerSshRelayTarget(testInfo)
      await waitForSessionReady(mantaPage)
      await waitForActiveWorktree(mantaPage)
      const remote = await connectDockerSshRelayTarget(mantaPage, target)
      await ensureTerminalVisible(mantaPage, 45_000)
      await waitForActiveTerminalManager(mantaPage, 60_000)
      const ptyId = await waitForActivePanePtyId(mantaPage, 60_000)
      const terminalHandle = await findTerminalByPtyId(mantaPage, ptyId)

      const marker = `PI_COMPATIBLE_TITLE_READY_${Date.now()}`
      await sendToTerminal(mantaPage, ptyId, `printf '${marker}\\n'\r`)
      await waitForTerminalOutput(mantaPage, marker, 20_000, 60_000)

      await emitOscTitle(mantaPage, ptyId, '\u280b OMP')
      await expect
        .poll(async () => readTerminalAgentStatus(mantaPage, terminalHandle), {
          timeout: 10_000,
          message: 'Remote OMP working title did not classify as an agent status'
        })
        .toMatchObject({ isRunningAgent: true, status: 'working' })

      await emitOscTitle(mantaPage, ptyId, 'OMP ready')
      await expect
        .poll(async () => readTerminalAgentStatus(mantaPage, terminalHandle), {
          timeout: 10_000,
          message: 'Remote OMP ready title did not classify as idle'
        })
        .toMatchObject({ isRunningAgent: true, status: 'idle' })

      await emitOscTitle(mantaPage, ptyId, '\u280b Pi')
      await expect
        .poll(async () => readTerminalAgentStatus(mantaPage, terminalHandle), {
          timeout: 10_000,
          message: 'Remote Pi working title did not classify as an agent status'
        })
        .toMatchObject({ isRunningAgent: true, status: 'working' })

      testInfo.annotations.push({
        type: 'docker-ssh-pi-compatible-title',
        description: `target=${remote.targetId} repo=${remote.repoId} worktree=${remote.worktreeId} pty=${ptyId} terminal=${terminalHandle}`
      })
    } finally {
      cleanupDockerSshRelayTarget(target)
    }
  })
})
