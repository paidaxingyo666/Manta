import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeRelayRuntime } from './relay-runtime-identity'
import { runRelayRuntimeSelfTest } from './relay-runtime-self-test'

const nodePtyDir = dirname(require.resolve('node-pty/package.json'))
const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('relay runtime identity', () => {
  it('names the pinned store layout pinned-node and anything else host-node', () => {
    const sha = 'a'.repeat(64)
    expect(describeRelayRuntime(`/h/.manta-remote/runtimes/node-${sha}/bin/node`).kind).toBe(
      'pinned-node'
    )
    expect(describeRelayRuntime('/usr/bin/node').kind).toBe('host-node')
    expect(describeRelayRuntime(`/tmp/node-${sha}/bin/node`).kind).toBe('host-node')
    expect(describeRelayRuntime('/usr/bin/node').version).toBe(process.versions.node)
  })
})

describe.skipIf(process.platform === 'win32')('relay runtime self-test', () => {
  it('loads pty.node and opens and closes a PTY, echoing the nonce', async () => {
    const report = await runRelayRuntimeSelfTest('nonce-1', nodePtyDir)
    expect(report).toMatchObject({ nonce: 'nonce-1', ok: true, node: process.version })
  })

  it('reports a load-stage failure when the binding is absent', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'relay-selftest-'))
    directories.push(empty)
    const report = await runRelayRuntimeSelfTest('n', empty)
    expect(report).toMatchObject({ ok: false, stage: 'load' })
  })
})
