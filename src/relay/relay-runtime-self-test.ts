/**
 * `relay.js --manta-runtime-selftest <nonce>`: prove this runtime can load the shipped
 * node-pty binding and open a PTY before a client launches a daemon on it (design D5).
 *
 * Why a separate process run rather than trusting the daemon's first spawn: a runtime
 * that cannot load the addon must be refused before a daemon holds the version dir, so
 * the client can still choose another runtime for that directory.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import type * as NodePty from 'node-pty'
import { detectNativeHostAbi } from '../main/mantad/native-host-abi'
import {
  RELAY_RUNTIME_SELF_TEST_PREFIX,
  type RelayRuntimeSelfTestReport
} from '../shared/relay-runtime-self-test-report'
import { describeRelayRuntime } from './relay-runtime-identity'

const PTY_EXIT_TIMEOUT_MS = 10_000

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ptyBindingPath(nodePtyDir: string): string | null {
  for (const dir of ['build/Release', 'build/Debug']) {
    const candidate = join(nodePtyDir, dir, 'pty.node')
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function openAndClosePty(pty: typeof NodePty): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = pty.spawn('/bin/sh', ['-c', 'exit 0'], {
      name: 'xterm',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`the PTY child did not exit within ${PTY_EXIT_TIMEOUT_MS / 1000}s`))
    }, PTY_EXIT_TIMEOUT_MS)
    child.onExit(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export async function runRelayRuntimeSelfTest(
  nonce: string,
  nodePtyDir: string = join(__dirname, 'node_modules', 'node-pty')
): Promise<RelayRuntimeSelfTestReport> {
  const abi = detectNativeHostAbi()
  const base = {
    nonce,
    node: process.version,
    napi: process.versions.napi ?? null,
    glibcVersionRuntime: abi.glibcVersion,
    runtime: describeRelayRuntime().kind
  }
  const binding = ptyBindingPath(nodePtyDir)
  if (!binding) {
    return { ...base, ok: false, stage: 'load', error: `no pty.node under ${nodePtyDir}` }
  }
  try {
    // Why dlopen first: node-pty's loader rethrows only its last attempt, which hides the
    // dynamic loader's message the client classifies (GLIBC_x not found, missing .so).
    process.dlopen({ exports: {} }, binding)
  } catch (error) {
    return { ...base, ok: false, stage: 'load', error: errorText(error) }
  }
  let pty: typeof NodePty
  try {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: node-pty's own entry, the module the relay's PtyHandler requires by the same path.
    pty = require(join(nodePtyDir, 'lib', 'index.js')) as typeof NodePty
  } catch (error) {
    return { ...base, ok: false, stage: 'load', error: errorText(error) }
  }
  try {
    await openAndClosePty(pty)
  } catch (error) {
    return { ...base, ok: false, stage: 'spawn', error: errorText(error) }
  }
  return { ...base, ok: true }
}

export async function runRelayRuntimeSelfTestCommand(nonce: string): Promise<never> {
  const report = await runRelayRuntimeSelfTest(nonce)
  process.stdout.write(`${RELAY_RUNTIME_SELF_TEST_PREFIX}${JSON.stringify(report)}\n`, () =>
    process.exit(0)
  )
  return new Promise<never>(() => {})
}
