// Design D5/D6 hostile-host matrix: the real client-side relay deploy against container SSH
// targets, asserting which rung of the runtime ladder each host lands on.
//
// Run: ORCA_RUN_SSH_HOSTILE_HOSTS=1 pnpm test src/main/ssh/ssh-relay-hostile-hosts.docker.test.ts
// Needs Linux Docker (the no-egress cell dials an internal bridge directly), `pnpm build:relay`,
// and an mantad template with both x64 Linux slots:
//   node config/scripts/build-mantad-template.mjs --targets linux-x64-glibc,linux-x64-musl
// ORCA_SSH_HOSTILE_HOST_CELLS=id,id narrows the run. .github/workflows/ssh-hostile-hosts.yml runs it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import type { SshConnection } from './ssh-connection'
import { HOSTILE_HOST_CELLS, selectHostileHostCells } from './ssh-hostile-host-cells'
import {
  assertCell,
  connectHostileHost,
  deployOnce,
  exerciseLaunchedCell,
  installHostileHostAppEnvironment,
  TERMINAL_PROBES
} from './ssh-hostile-host-test-harness'
import {
  dockerHostObserver,
  hostExecStatus,
  hostileHostSshTarget,
  startHostileHostTarget,
  stopHostileHostTarget,
  type HostileHostTarget
} from './ssh-hostile-host-test-fixture'

const RUN = process.env.ORCA_RUN_SSH_HOSTILE_HOSTS === '1'
const SELECTED = new Set(
  RUN ? selectHostileHostCells(process.env.ORCA_SSH_HOSTILE_HOST_CELLS).map((cell) => cell.id) : []
)
const CELL_TIMEOUT_MS = 15 * 60_000

describe('SSH relay hostile-host matrix', () => {
  let cleanupAppEnvironment: (() => void) | null = null

  beforeAll(() => {
    cleanupAppEnvironment = installHostileHostAppEnvironment()
  })

  afterAll(() => {
    cleanupAppEnvironment?.()
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
          const observer = dockerHostObserver(target)
          const sshTarget = hostileHostSshTarget(target)
          conn = await connectHostileHost(sshTarget)
          const first = await deployOnce(conn)
          await assertCell(cell, observer, first)
          if (cell.expect.outcome === 'launched') {
            await exerciseLaunchedCell({
              cell,
              observer,
              sshTarget,
              terminal: TERMINAL_PROBES.posix,
              first,
              firstConn: conn
            })
          } else if (
            cell.expect.outcome !== 'legacy_opt_out' &&
            cell.expect.refusals[0]?.reason === 'libc_floor'
          ) {
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
