import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { homedirMock } = vi.hoisted(() => ({ homedirMock: vi.fn<() => string>() }))
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return { ...actual, homedir: homedirMock }
})

import { JcodeHookService } from './hook-service'
import { getJcodeManagedScriptPath } from './hook-settings'

/** Installs the managed hook into a throwaway home and returns the script path. */
function installManagedScript(): { scriptPath: string; cleanup: () => void } {
  const homeDir = mkdtempSync(join(tmpdir(), 'orca-jcode-gate-'))
  homedirMock.mockReturnValue(homeDir)
  vi.stubEnv('JCODE_HOME', join(homeDir, '.jcode'))
  new JcodeHookService().install()
  const scriptPath = getJcodeManagedScriptPath()
  return {
    scriptPath,
    cleanup: () => {
      vi.unstubAllEnvs()
      rmSync(homeDir, { recursive: true, force: true })
    }
  }
}

describe.runIf(process.platform !== 'win32')('jcode managed hook as jcode runs it', () => {
  it('returns immediately on pre_tool even when the hook server never answers', async () => {
    const { scriptPath, cleanup } = installManagedScript()
    // A server that accepts the connection and then never replies: curl holds it
    // open until its own --max-time 1.5, which is what a synchronous gate would
    // hand straight to the agent on every single tool call.
    const blackHole: Server = createServer(() => {})
    await new Promise<void>((resolve) => blackHole.listen(0, '127.0.0.1', resolve))
    const address = blackHole.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const endpointDir = mkdtempSync(join(tmpdir(), 'orca-jcode-endpoint-'))
    try {
      const endpoint = join(endpointDir, 'endpoint.sh')
      writeFileSync(
        endpoint,
        `MANTA_AGENT_HOOK_PORT=${port}\nMANTA_AGENT_HOOK_TOKEN=t\nexport MANTA_AGENT_HOOK_PORT MANTA_AGENT_HOOK_TOKEN\n`
      )

      // A tool input far larger than a 64 KB pipe buffer: jcode write_all()s this
      // to the gate's stdin and awaits it, so a gate that never reads stdin stalls.
      const bigToolInput = JSON.stringify({ content: 'x'.repeat(512 * 1024) })
      const startedAt = Date.now()
      execFileSync('/bin/sh', [scriptPath], {
        input: bigToolInput,
        env: {
          ...process.env,
          MANTA_AGENT_HOOK_ENDPOINT: endpoint,
          MANTA_PANE_KEY: 'tab-1:leaf-1',
          JCODE_HOOK_EVENT: 'pre_tool',
          JCODE_HOOK_SESSION_ID: 'session_gate_1',
          JCODE_HOOK_PAYLOAD: JSON.stringify({ event: 'pre_tool', tool_name: 'write' })
        },
        // Why: the assertion below is the real gate; this only stops a regression
        // from hanging the suite instead of failing it.
        timeout: 20_000,
        // stdio is the point of the test: jcode reads stderr to EOF, so an
        // inherited pipe in a backgrounded child would hold the gate open for as
        // long as the POST ran, detached or not.
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const elapsed = Date.now() - startedAt

      // Comfortably under curl's 1.5s ceiling: a synchronous POST would sit on
      // that ceiling for every tool call, and jcode's own budget is only 5s.
      expect(elapsed).toBeLessThan(1_000)
    } finally {
      rmSync(endpointDir, { recursive: true, force: true })
      await new Promise<void>((resolve) => blackHole.close(() => resolve()))
      cleanup()
    }
  })

  it('drains the gate stdin before exiting on a missing Manta environment', () => {
    const { scriptPath, cleanup } = installManagedScript()
    try {
      const startedAt = Date.now()
      execFileSync('/bin/sh', [scriptPath], {
        input: JSON.stringify({ content: 'y'.repeat(512 * 1024) }),
        // No MANTA_PANE_KEY: the script exits early, but only after taking stdin.
        env: { ...process.env, JCODE_HOOK_EVENT: 'pre_tool', MANTA_PANE_KEY: '' },
        timeout: 20_000,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      expect(Date.now() - startedAt).toBeLessThan(2_000)
    } finally {
      cleanup()
    }
  })

  it('posts synchronously for observer events, which jcode never waits on', () => {
    const { scriptPath, cleanup } = installManagedScript()
    try {
      const script = readFileSync(scriptPath, 'utf8')
      const gateBranch = script.slice(script.indexOf('if [ "$JCODE_HOOK_EVENT" = pre_tool ]'))
      expect(gateBranch).toContain('orca_post_jcode_event >/dev/null 2>&1 &')
      // The observer path keeps the foreground call, so a slow POST cannot be lost
      // to a script that exited first.
      expect(gateBranch).toContain('orca_post_jcode_event >/dev/null 2>&1 || :')
      expect(script.trimEnd().endsWith('exit 0')).toBe(true)
    } finally {
      cleanup()
    }
  })
})

describe.runIf(process.platform !== 'win32')('managed script shape', () => {
  it('writes an executable script jcode can exec directly', () => {
    const { scriptPath, cleanup } = installManagedScript()
    try {
      mkdirSync(dirname(scriptPath), { recursive: true })
      chmodSync(scriptPath, 0o755)
      const script = readFileSync(scriptPath, 'utf8')
      // Why: jcode parses the command shell-style but executes it directly, so the
      // file itself must carry the interpreter.
      expect(script.startsWith('#!/bin/sh\n')).toBe(true)
    } finally {
      cleanup()
    }
  })
})
