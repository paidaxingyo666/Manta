// Design D5/D6 hostile-host matrix: the real client-side relay deploy against container SSH
// targets, asserting which rung of the runtime ladder each host lands on.
//
// Run: ORCA_RUN_SSH_HOSTILE_HOSTS=1 pnpm test src/main/ssh/ssh-relay-hostile-hosts.docker.test.ts
// Needs Linux Docker (the no-egress cell dials an internal bridge directly), `pnpm build:relay`,
// and an mantad template with both x64 Linux slots:
//   node config/scripts/build-mantad-template.mjs --targets linux-x64-glibc,linux-x64-musl
// ORCA_SSH_HOSTILE_HOST_CELLS=id,id narrows the run. .github/workflows/ssh-hostile-hosts.yml runs it.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { setAppEnvironment } from '../../shared/app-environment'
import type { ServerTarget } from '../../shared/node-runtime-pin'
import { NODE_RUNTIME_ASSETS } from '../../shared/node-runtime-pin'
import type { SshRemoteRuntimeRung, SshTarget } from '../../shared/ssh-types'
import { gcRemoteNodeRuntimeStore } from './remote-node-runtime-store-gc'
import { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { SshConnection } from './ssh-connection'
import {
  FORBIDDEN_TOOL_LOG,
  HOSTILE_HOST_CELLS,
  hostileHostCellViolations,
  parseForbiddenToolLog,
  selectHostileHostCells,
  type HostileHostCell,
  type RungRefusal
} from './ssh-hostile-host-cells'
import {
  hostExec,
  hostExecStatus,
  hostileHostSshTarget,
  startHostileHostTarget,
  stopHostileHostTarget,
  type HostileHostTarget
} from './ssh-hostile-host-test-fixture'
import { openSshPtyConsumerSession } from './ssh-pty-consumer-session'
import { retrySshOwnerRecoveryWhileBlocked } from './ssh-owner-recovery-retry'
import { deployAndLaunchRelay, type RelayDeployResult } from './ssh-relay-deploy'
import { pinnedRelayNodePath } from './ssh-relay-pinned-node'
import {
  RelayRuntimeLadderRun,
  RemoteRuntimeUnavailableError
} from './ssh-relay-runtime-resolution'

const RUN = process.env.ORCA_RUN_SSH_HOSTILE_HOSTS === '1'
const SELECTED = new Set(
  RUN ? selectHostileHostCells(process.env.ORCA_SSH_HOSTILE_HOST_CELLS).map((cell) => cell.id) : []
)
const CELL_TIMEOUT_MS = 15 * 60_000

type DeployAttempt = {
  deployed: RelayDeployResult | null
  error: unknown
  refusals: RungRefusal[]
  settledRung: SshRemoteRuntimeRung | null
  run: RelayRuntimeLadderRun | null
}

async function connect(sshTarget: SshTarget): Promise<SshConnection> {
  const conn = new SshConnection(sshTarget, { onStateChange: () => {} })
  await conn.connect()
  return conn
}

/** One real deploy, with the ladder's own refusal and settle calls as the observation. */
async function deployOnce(conn: SshConnection): Promise<DeployAttempt> {
  const refused = vi.spyOn(RelayRuntimeLadderRun.prototype, 'refused')
  const settle = vi.spyOn(RelayRuntimeLadderRun.prototype, 'settle')
  const attempt: DeployAttempt = {
    deployed: null,
    error: null,
    refusals: [],
    settledRung: null,
    run: null
  }
  try {
    attempt.deployed = await deployAndLaunchRelay(conn, undefined, 60)
  } catch (error) {
    attempt.error = error
  } finally {
    attempt.refusals = refused.mock.calls.map(([step, reason]) => ({ step, reason }))
    attempt.settledRung = settle.mock.calls.at(-1)?.[0] ?? null
    const context: unknown = settle.mock.contexts.at(-1)
    attempt.run = context instanceof RelayRuntimeLadderRun ? context : null
    refused.mockRestore()
    settle.mockRestore()
  }
  return attempt
}

async function assertCell(
  cell: HostileHostCell,
  target: HostileHostTarget,
  attempt: DeployAttempt
): Promise<void> {
  const log = await hostExec(target, `cat ${FORBIDDEN_TOOL_LOG} 2>/dev/null || true`)
  const { error } = attempt
  const violations = hostileHostCellViolations(cell, {
    settledRung: attempt.settledRung,
    target: attempt.run?.facts?.target ?? null,
    unavailableReason: error instanceof RemoteRuntimeUnavailableError ? error.reason : null,
    deployError: error ? (error instanceof Error ? error.message : String(error)) : null,
    refusals: attempt.refusals,
    forbiddenToolCalls: parseForbiddenToolLog(log)
  })
  expect(violations, `${cell.id}: ${violations.join('; ')}`).toEqual([])
}

/** Opens a PTY as the session owner and waits for the shell to evaluate what it was sent. */
async function assertTerminalEchoes(
  deployed: RelayDeployResult,
  clientInstanceId: string
): Promise<void> {
  const mux = new SshChannelMultiplexer(deployed.transport)
  try {
    // Why retry: the first connect's owner stays held for its grace period, and the app retries too.
    await retrySshOwnerRecoveryWhileBlocked(
      () =>
        openSshPtyConsumerSession(mux, {
          clientInstanceId,
          expectedServerBuildId: deployed.serverBuildId
        }),
      { isCurrent: () => true, onClosed: () => () => {} }
    )
    const output = new Map<string, string>()
    mux.onNotificationByMethod('pty.data', (params) => {
      if (typeof params.id === 'string' && typeof params.data === 'string') {
        output.set(params.id, (output.get(params.id) ?? '') + params.data)
      }
    })
    const spawned: unknown = await mux.request('pty.spawn', { cols: 80, rows: 24 })
    const id =
      spawned && typeof spawned === 'object' && 'id' in spawned && typeof spawned.id === 'string'
        ? spawned.id
        : ''
    expect(id).not.toBe('')
    // Why arithmetic: only the shell's evaluation prints 42, never the echoed keystrokes.
    mux.notify('pty.data', { id, data: 'echo ORCA_HOSTILE_$((6*7))\r' })
    const deadline = Date.now() + 30_000
    while (!(output.get(id) ?? '').includes('ORCA_HOSTILE_42') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    expect(output.get(id) ?? '').toContain('ORCA_HOSTILE_42')
    await mux.request('pty.shutdown', { id })
  } finally {
    mux.dispose()
  }
}

function runtimeNodePath(deployed: RelayDeployResult, serverTarget: ServerTarget): string {
  if (!deployed.hostPlatform || !deployed.remoteRelayDir) {
    throw new Error('A pinned deploy must report its host and relay directory')
  }
  return pinnedRelayNodePath(deployed.hostPlatform, deployed.remoteRelayDir, serverTarget)
}

/**
 * Plants an older and a newer idle runtime beside the live one and collects with no client pin:
 * only the reference and the running relay can keep the live runtime.
 */
async function assertGcKeepsInUseRuntime(
  conn: SshConnection,
  target: HostileHostTarget,
  deployed: RelayDeployResult,
  nodePath: string
): Promise<void> {
  const store = posix.dirname(posix.dirname(posix.dirname(nodePath)))
  const older = `node-${'a'.repeat(64)}`
  const newer = `node-${'b'.repeat(64)}`
  await hostExec(
    target,
    [
      `cd '${store}'`,
      `mkdir -p ${older}/bin ${newer}/bin`,
      `touch -t 200001010000 ${older}/.verified`,
      `touch ${newer}/.verified`
    ].join(' && ')
  )
  const { hostPlatform, remoteHome } = deployed
  if (!hostPlatform || !remoteHome) {
    throw new Error('A pinned deploy must report its host and home')
  }
  let state = 'skipped'
  // Why retry: the deploy's own background GC may still hold the store lock.
  for (let attempt = 0; attempt < 20 && state !== 'collected'; attempt++) {
    const result = await gcRemoteNodeRuntimeStore(conn, hostPlatform, remoteHome, {
      currentPins: []
    })
    state = result.state
    if (state !== 'collected') {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
  }
  expect(state).toBe('collected')
  expect(await hostExecStatus(target, `test -x '${nodePath}'`)).toBe(0)
  expect(await hostExecStatus(target, `test -d '${store}/${newer}'`)).toBe(0)
  expect(await hostExecStatus(target, `test -e '${store}/${older}'`)).not.toBe(0)
}

async function exerciseLaunchedCell(
  cell: HostileHostCell,
  target: HostileHostTarget,
  sshTarget: SshTarget,
  first: DeployAttempt,
  firstConn: SshConnection
): Promise<void> {
  if (cell.expect.outcome !== 'launched' || !first.deployed || !first.run) {
    throw new Error(`${cell.id} did not launch a relay`)
  }
  expect(first.run.selfTest).toBe('passed')
  expect(first.run.runtimeTransfer).toBe('uploaded')
  const nodePath = runtimeNodePath(first.deployed, cell.expect.target)
  expect(posix.basename(posix.dirname(posix.dirname(nodePath)))).toBe(
    `node-${NODE_RUNTIME_ASSETS[cell.expect.target].executableSha256}`
  )
  // Why one id for both connects: the app reconnects as the same client instance.
  const clientInstanceId = randomUUID()
  await assertTerminalEchoes(first.deployed, clientInstanceId)
  await assertGcKeepsInUseRuntime(firstConn, target, first.deployed, nodePath)
  const before = await hostExec(target, `stat -c '%i:%Y' '${nodePath}'`)
  await firstConn.disconnect()

  const secondConn = await connect(sshTarget)
  try {
    const second = await deployOnce(secondConn)
    await assertCell(cell, target, second)
    expect(second.run?.runtimeTransfer).toBe('cached')
    expect(await hostExec(target, `stat -c '%i:%Y' '${nodePath}'`)).toBe(before)
    if (!second.deployed) {
      throw new Error(`${cell.id} did not relaunch on the second connect`)
    }
    await assertTerminalEchoes(second.deployed, clientInstanceId)
  } finally {
    await secondConn.disconnect()
  }
}

describe('SSH relay hostile-host matrix', () => {
  let userData = ''

  beforeAll(() => {
    userData = mkdtempSync(join(tmpdir(), 'orca-hostile-hosts-userdata-'))
    const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    setAppEnvironment({
      getPath: (name) => (name === 'userData' ? userData : tmpdir()),
      getAppPath: () => process.cwd(),
      getVersion: () => version,
      isPackaged: () => false,
      onWillQuit: () => {},
      exit: () => {},
      getAppMetrics: () => []
    })
  })

  afterAll(() => {
    if (userData) {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  for (const cell of HOSTILE_HOST_CELLS) {
    it.skipIf(!SELECTED.has(cell.id))(
      `${cell.id} lands on ${cell.expect.outcome === 'launched' ? `rung ${cell.expect.rung}` : cell.expect.outcome}`,
      async () => {
        let target: HostileHostTarget | null = null
        let conn: SshConnection | null = null
        try {
          target = await startHostileHostTarget(cell)
          if (cell.noEgress) {
            expect(
              await hostExecStatus(target, "timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443'")
            ).not.toBe(0)
          }
          const sshTarget = hostileHostSshTarget(target)
          conn = await connect(sshTarget)
          const first = await deployOnce(conn)
          await assertCell(cell, target, first)
          if (cell.expect.outcome === 'launched') {
            await exerciseLaunchedCell(cell, target, sshTarget, first, conn)
          } else if (cell.expect.refusals[0]?.reason === 'libc_floor') {
            // Refused from the probe alone: nothing was uploaded.
            expect(
              await hostExecStatus(target, 'ls -d /root/.manta-remote/runtimes/node-*')
            ).not.toBe(0)
          }
        } finally {
          await conn?.disconnect().catch(() => {})
          await stopHostileHostTarget(target)
        }
      },
      CELL_TIMEOUT_MS
    )
  }
})
