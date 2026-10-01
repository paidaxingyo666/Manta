/**
 * Design D7.1 R1/R3/R4 and D7.2: a live terminal survives the mantad runtime swap in both
 * directions. The last Bun mantad (ORCA_BUN_ORCAD_SLOT) and this checkout's Node slot (out/mantad)
 * are installed side by side as `~/.manta-remote/mantad-<version>/`, launched and stopped with
 * the client's own deploy commands, and share one data root.
 */
import { build } from 'esbuild'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { NODE_RUNTIME_ASSETS } from '../../shared/node-runtime-pin'
import {
  ORCAD_BUILD_TARGET_FILENAME,
  MANTAD_INSTALL_COMPLETE_FILENAME,
  ORCAD_NODE_RUNTIME_MARKER_FILENAME,
  MANTAD_VERSION_FILENAME,
  orcadBunRuntimeFilename,
  orcadNodeRuntimeRelativePath
} from '../../shared/mantad-artifacts'
import { removeTreeSync } from '../../shared/windows-transient-lock-removal'
import { PROTOCOL_VERSION } from '../daemon/types'
import type { ServeReadiness } from '../server/serve-readiness'
import {
  getMantaProfileIndexPath,
  getMantaProfileStateDatabaseFile
} from '../manta-profiles/profile-storage-paths'
import type { SshConnection } from '../ssh/ssh-connection'
import { emptyOrcadActivationRecord, orcadGcPinnedDirNames } from '../ssh/mantad-activation-record'
import { gcOldOrcadVersions } from '../ssh/mantad-remote-gc'
import {
  MANTAD_PID_FILENAME,
  MANTAD_READINESS_FILENAME,
  orcadLaunchCommand,
  parseOrcadReadinessOutput
} from '../ssh/mantad-remote-launch'
import { parseOrcadStopOutcome, stopOrcadCommand } from '../ssh/mantad-remote-process-control'
import { RELAY_REMOTE_DIR } from '../ssh/relay-protocol'
import { getRemoteHostPlatform } from '../ssh/ssh-remote-platform'
import {
  skipForMissingInputs,
  hostServerTarget,
  locatePinnedNodeForTests
} from './orcad-node-slot-fixture'

// GC runs its real commands, against this machine instead of an SSH host.
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('../ssh/ssh-relay-deploy-helpers', () => ({ execCommand: execMock }))

type Runtime = 'Bun' | 'Node'
type Slot = { runtime: Runtime; dir: string; version: string }
type ClientResult = { pid: number; isReattach: boolean; output: boolean }

const pinnedNode = locatePinnedNodeForTests()
const bunSlotSource = process.env.ORCA_BUN_ORCAD_SLOT
  ? resolve(process.env.ORCA_BUN_ORCAD_SLOT)
  : null
const nodeSlotSource = resolve('out/mantad')
const posix = process.platform !== 'win32'
const host = getRemoteHostPlatform(
  process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? 'darwin-arm64'
      : 'darwin-x64'
    : process.arch === 'arm64'
      ? 'linux-arm64'
      : 'linux-x64'
)
const missing = [
  ...(pinnedNode ? [] : ['the pinned Node (ORCA_PINNED_NODE or out/runtimes)']),
  ...(existsSync(join(nodeSlotSource, ORCAD_NODE_RUNTIME_MARKER_FILENAME))
    ? []
    : ['a Node mantad slot in out/mantad (pnpm build:mantad)']),
  ...(bunSlotSource &&
  existsSync(join(bunSlotSource, ORCAD_BUILD_TARGET_FILENAME)) &&
  existsSync(join(bunSlotSource, orcadBunRuntimeFilename(process.platform)))
    ? []
    : ['a Bun mantad slot at ORCA_BUN_ORCAD_SLOT (build-mantad-bun.mjs --out-dir)'])
]

let root = ''
let client = ''
let backupDriver = ''
const launched = new Set<number>()

/** Without Vitest's markers: daemon-entry.js does not start its server under VITEST. */
function hostEnv(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_ENV')
    ),
    MANTA_BACKGROUND_LAUNCH: '1',
    MANTA_DISABLE_MACOS_LOGIN_SHELL: '1'
  }
}

function shell(command: string, timeoutMs = 60_000): Promise<string> {
  return runProcess({
    program: '/bin/sh',
    args: ['-c', command],
    env: hostEnv(),
    timeoutMs
  }).then((result) => {
    if (result.code !== 0) {
      throw new Error(`shell exited ${result.code}: ${result.stderr}\n${command}`)
    }
    return result.stdout
  })
}

function linkOrCopy(from: string, to: string): void {
  try {
    linkSync(from, to)
  } catch {
    copyFileSync(from, to)
  }
}

/** Hard-links a slot tree into place: an install copies bytes, and links keep the test cheap. */
function installTree(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      installTree(from, to)
    } else {
      linkOrCopy(from, to)
    }
  }
}

function installSlot(caseRoot: string, runtime: Runtime, source: string): Slot {
  const version = readFileSync(join(source, MANTAD_VERSION_FILENAME), 'utf8').trim()
  const dir = join(caseRoot, RELAY_REMOTE_DIR, `mantad-${version}`)
  installTree(source, dir)
  writeFileSync(join(dir, MANTAD_INSTALL_COMPLETE_FILENAME), '')
  return { runtime, dir, version }
}

/** Both slots under one `.manta-remote/`, the Node one with its shared `runtimes/` entry. */
function installSlots(caseRoot: string): { slots: Record<Runtime, Slot>; nodeRuntime: string } {
  const slots = {
    Bun: installSlot(caseRoot, 'Bun', bunSlotSource!),
    Node: installSlot(caseRoot, 'Node', nodeSlotSource)
  }
  const target = hostServerTarget()
  const nodeRuntime = join(
    slots.Node.dir,
    ...orcadNodeRuntimeRelativePath(target, NODE_RUNTIME_ASSETS[target].executableSha256)
  )
  mkdirSync(join(nodeRuntime, '..'), { recursive: true })
  linkOrCopy(realpathSync(pinnedNode!), nodeRuntime)
  return { slots, nodeRuntime: resolve(nodeRuntime) }
}

async function launch(slot: Slot, userDataDir: string): Promise<ServeReadiness> {
  const pid = Number(
    (
      await shell(
        orcadLaunchCommand(host, {
          remoteInstallDir: slot.dir,
          nodePath: pinnedNode!,
          fullVersion: slot.version,
          userDataDir,
          bindHost: '127.0.0.1',
          port: 0
        })
      )
    ).trim()
  )
  launched.add(pid)
  let readiness: ServeReadiness | null = null
  await vi.waitFor(
    () => {
      const parsed = parseOrcadReadinessOutput(
        readFileSync(join(slot.dir, MANTAD_READINESS_FILENAME), 'utf8')
      )
      if (parsed.state !== 'ready') {
        const log = existsSync(join(slot.dir, 'mantad.log'))
          ? readFileSync(join(slot.dir, 'mantad.log'), 'utf8')
          : ''
        throw new Error(`${slot.runtime} mantad not ready (${parsed.state}): ${log.slice(-2000)}`)
      }
      readiness = parsed.readiness
    },
    { timeout: 90_000, interval: 250 }
  )
  return readiness!
}

async function stop(slot: Slot): Promise<void> {
  const outcome = parseOrcadStopOutcome(
    await shell(stopOrcadCommand(host, slot.dir, { waitSeconds: 30, nodePath: pinnedNode! }))
  )
  expect(outcome, `${slot.runtime} mantad stop`).toBe('stopped')
}

async function daemonClient(
  op: 'create' | 'attach' | 'kill',
  userDataDir: string,
  sessionId: string,
  marker: string
): Promise<ClientResult> {
  const result = await runProcess({
    program: pinnedNode!,
    args: [client, op, join(userDataDir, 'daemon'), sessionId, marker, root],
    env: hostEnv(),
    timeoutMs: 30_000
  })
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '')
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function processCommand(pid: number): Promise<string> {
  return (await shell(`ps -o command= -p ${pid}`)).trim()
}

async function backUpProfile(slot: Slot, runtime: string, userDataDir: string): Promise<void> {
  const index = JSON.parse(readFileSync(getMantaProfileIndexPath(userDataDir), 'utf8'))
  const profileId = String(index.activeProfileId)
  const result = await runProcess({
    program: runtime,
    args: [
      backupDriver,
      join(slot.dir, 'profile-state-backup-worker-entry.js'),
      getMantaProfileStateDatabaseFile(profileId, userDataDir),
      profileId,
      join(userDataDir, `backup-by-${slot.runtime}.db`)
    ],
    env: hostEnv(),
    timeoutMs: 60_000
  })
  expect(result.code, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '')).toEqual({ ok: true })
}

// Windows has no mantad launch path (POSIX-only, mantad-remote-host-support.ts), so no inputs.
const skip = skipForMissingInputs('cross-runtime', posix ? missing : [])

describe.skipIf(skip || !posix)('a live terminal across the Bun and Node mantad runtimes', () => {
  beforeAll(async () => {
    // Short root: macOS caps a unix socket path at 104 bytes and the daemon's lives in the data root.
    root = realpathSync(mkdtempSync('/tmp/orca-xrt-'))
    client = join(root, 'daemon-client.cjs')
    backupDriver = join(root, 'backup-driver.cjs')
    execMock.mockImplementation(async (_conn: unknown, command: string) => shell(command))
    writeFileSync(
      backupDriver,
      // The shipped worker entry, driven the way mantad drives it, under the slot's own runtime.
      `const { Worker } = require('node:worker_threads')
const [workerPath, databasePath, profileId, targetPath] = process.argv.slice(2)
const worker = new Worker(workerPath, { workerData: { databasePath, profileId, targetPath } })
worker.on('message', (message) => console.log(JSON.stringify(message)))
worker.on('error', (error) => { console.error(error); process.exitCode = 1 })
`
    )
    await build({
      stdin: {
        // mantad's own daemon client, playing a paired client's terminal.
        contents: `
        import { DaemonPtyAdapter } from './src/main/daemon/daemon-pty-adapter'
        import { getDaemonPidPath, getDaemonSocketPath, getDaemonTokenPath } from './src/main/daemon/daemon-spawner'
        import { setAppEnvironment } from './src/shared/app-environment'
        const [op, runtimeDir, sessionId, marker, cwd] = process.argv.slice(2)
        setAppEnvironment({
          getPath: () => cwd, getAppPath: () => cwd, getVersion: () => 'test', isPackaged: () => true,
          onWillQuit() {}, exit: code => process.exit(code), getAppMetrics: () => []
        })
        const adapter = new DaemonPtyAdapter({
          socketPath: getDaemonSocketPath(runtimeDir), tokenPath: getDaemonTokenPath(runtimeDir),
          pidPath: getDaemonPidPath(runtimeDir), profileScope: runtimeDir, runtimeDir
        })
        let output = ''
        adapter.onData(event => { if (event.id === sessionId) output += event.data })
        const deadline = setTimeout(() => { console.error('timed out; output: ' + output); process.exit(98) }, 20_000)
        ;(async () => {
          const spawned = await adapter.spawn(op === 'create'
            ? { sessionId, cols: 80, rows: 24, cwd, shellOverride: '/bin/sh' }
            : { sessionId, cols: 80, rows: 24 })
          if (op === 'kill') {
            await adapter.shutdown(spawned.id, { immediate: true })
          } else {
            // The echoed command line holds the format, never the expanded marker.
            adapter.write(spawned.id, "printf 'ORCA_XRT_%s\\\\n' " + marker + "\\r")
            while (!output.includes('ORCA_XRT_' + marker)) await new Promise(r => setTimeout(r, 50))
          }
          clearTimeout(deadline)
          await adapter.disconnectOnly()
          console.log(JSON.stringify({ pid: spawned.pid, isReattach: spawned.isReattach === true, output: output.includes('ORCA_XRT_' + marker) }))
          process.exit(0)
        })().catch(error => { console.error(error); process.exit(1) })
      `,
        resolveDir: process.cwd(),
        loader: 'ts'
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      external: ['electron', 'node-pty', '@parcel/watcher', '*.node'],
      outfile: client,
      logLevel: 'silent'
    })
  })

  afterEach(() => {
    for (const pid of launched) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
    launched.clear()
  })

  afterAll(() => {
    removeTreeSync(root)
  })

  it.each([
    ['Bun', 'Node'],
    ['Node', 'Bun']
  ] as const)(
    '%s mantad hands its daemon and profile to the %s mantad',
    async (from: Runtime, to: Runtime) => {
      const caseRoot = mkdtempSync(join(root, `${from}-${to}-`))
      const userDataDir = join(caseRoot, 'data')
      const { slots, nodeRuntime } = installSlots(caseRoot)
      const outgoing = slots[from]
      const incoming = slots[to]
      const sessionId = `xrt-${from}-${to}`
      let daemonPid: number | null = null
      try {
        const first = await launch(outgoing, userDataDir)
        const forked = first.health!.terminalDaemon
        expect(forked).toMatchObject({
          state: 'live',
          buildVersion: outgoing.version,
          entryPath: join(outgoing.dir, 'daemon-entry.js'),
          protocolVersion: PROTOCOL_VERSION
        })
        daemonPid = forked.pid!
        // The daemon runs on the runtime the outgoing slot shipped, not on the test's Node.
        const runtimes = {
          Bun: join(slots.Bun.dir, orcadBunRuntimeFilename(process.platform)),
          Node: nodeRuntime
        }
        expect(await processCommand(daemonPid)).toContain(runtimes[from])

        const created = await daemonClient('create', userDataDir, sessionId, 'BEFORE')
        expect(created).toMatchObject({ isReattach: false, output: true })

        await stop(outgoing)
        expect(isAlive(daemonPid)).toBe(true)
        expect(isAlive(created.pid)).toBe(true)

        const second = await launch(incoming, userDataDir)
        // Adopted, not replaced: same daemon, still reporting the outgoing build.
        expect(second.health!.terminalDaemon).toMatchObject({
          state: 'live',
          ownsFreshSessions: true,
          pid: daemonPid,
          buildVersion: outgoing.version,
          entryPath: join(outgoing.dir, 'daemon-entry.js'),
          protocolVersion: PROTOCOL_VERSION
        })
        // The incoming runtime opened the outgoing runtime's profile database.
        expect(first.health!.profileStateAuthority?.classification).toBe('neither')
        expect(second.health!.profileStateAuthority).toMatchObject({
          backend: 'sqlite',
          migrated: false
        })
        expect(second.health!.profileStateAuthority?.classification).not.toBe('neither')

        const attached = await daemonClient('attach', userDataDir, sessionId, 'AFTER')
        expect(attached).toEqual({ pid: created.pid, isReattach: true, output: true })

        // R4: the slot the live daemon was forked from survives GC; an idle stale slot does not.
        const stale = join(caseRoot, RELAY_REMOTE_DIR, 'mantad-0.0.1+dead')
        mkdirSync(stale)
        writeFileSync(join(stale, MANTAD_INSTALL_COMPLETE_FILENAME), '')
        writeFileSync(
          join(stale, MANTAD_PID_FILENAME),
          readFileSync(join(outgoing.dir, MANTAD_PID_FILENAME))
        )
        const record = { ...emptyOrcadActivationRecord(), active: incoming.version }
        expect(orcadGcPinnedDirNames(record)).not.toContain(`mantad-${outgoing.version}`)
        await gcOldOrcadVersions({
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: execCommand is replaced by a local shell for every connection access.
          conn: {} as SshConnection,
          host,
          remoteHome: caseRoot,
          currentDirAbsPath: incoming.dir,
          record,
          liveDaemonVersion: second.health!.terminalDaemon.buildVersion
        })
        expect(existsSync(stale)).toBe(false)
        expect(existsSync(join(outgoing.dir, 'daemon-entry.js'))).toBe(true)

        await stop(incoming)
        await backUpProfile(incoming, runtimes[to], userDataDir)

        await daemonClient('kill', userDataDir, sessionId, '')
        await vi.waitFor(() => expect(isAlive(created.pid)).toBe(false), { timeout: 10_000 })
      } finally {
        if (daemonPid && isAlive(daemonPid)) {
          process.kill(daemonPid, 'SIGKILL')
        }
      }
    },
    240_000
  )
})
