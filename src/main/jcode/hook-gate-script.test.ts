import { afterEach, describe, expect, it, vi } from 'vitest'
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
  it('returns on pre_tool in a fraction of what the same POST costs synchronously', async () => {
    const { scriptPath, cleanup } = installManagedScript()
    // A server that accepts the connection and then never replies, so curl holds it
    // open until its own --max-time. That wait is exactly what a synchronous gate
    // would hand the agent on every single tool call.
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

      /** Runs the managed hook for one event and returns how long the caller waited.
       *  Only the gate is fed stdin, because jcode gives its observer hooks a null one. */
      const runHook = (event: string): number => {
        // A tool input far larger than a 64 KB pipe buffer: jcode write_all()s this to
        // the gate's stdin and awaits it, so a gate that never reads stdin stalls.
        const input =
          event === 'pre_tool' ? JSON.stringify({ content: 'x'.repeat(512 * 1024) }) : ''
        const startedAt = Date.now()
        execFileSync('/bin/sh', [scriptPath], {
          input,
          env: {
            ...process.env,
            MANTA_AGENT_HOOK_ENDPOINT: endpoint,
            MANTA_PANE_KEY: 'tab-1:leaf-1',
            JCODE_HOOK_EVENT: event,
            JCODE_HOOK_SESSION_ID: 'session_gate_1',
            JCODE_HOOK_PAYLOAD: JSON.stringify({ event, tool_name: 'write' })
          },
          // Why: the assertion below is the real gate; this only stops a regression
          // from hanging the suite instead of failing it.
          timeout: 30_000,
          // stdio is the point of the test: jcode reads the gate's stderr to EOF, so a
          // backgrounded child that inherited it would hold the tool call open for as
          // long as the POST ran, detached or not.
          stdio: ['pipe', 'pipe', 'pipe']
        })
        return Date.now() - startedAt
      }

      // Why measure both rather than assert a wall-clock bound: the absolute numbers
      // move with the machine, and a bound tight enough to catch a synchronous gate on
      // a fast host goes flaky on a loaded CI runner. The ratio is the actual claim.
      const observerMs = runHook('turn_end')
      const gateMs = runHook('pre_tool')
      expect(gateMs * 4).toBeLessThan(observerMs)
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

describe('the Windows managed hook', () => {
  // Why these run everywhere: Windows is the platform this PR could not exercise on
  // real hardware, so the generated script's shape is pinned from any host.
  afterEach(() => vi.restoreAllMocks())

  function windowsScript(): string {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const { scriptPath, cleanup } = installManagedScript()
    try {
      return readFileSync(scriptPath, 'utf8')
    } finally {
      cleanup()
    }
  }

  it('drains the gate stdin, but only after the Manta environment check', () => {
    const script = windowsScript()
    const guardIndex = script.indexOf('if "%MANTA_PANE_KEY%"==""')
    const drainIndex = script.indexOf('if "%JCODE_HOOK_EVENT%"=="pre_tool"')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(drainIndex).toBeGreaterThan(guardIndex)
    // Why this order is inverted from the POSIX script: outside a Manta pane the
    // caller abandons stdin instead of closing it, so a hook that reads it hangs
    // forever and strands a console window (#11549). Exiting early instead costs
    // only jcode's own 5s pre_tool timeout, which fails open.
    expect(script).toContain('more.com')
  })

  it('is a CRLF batch file that always exits 0', () => {
    const script = windowsScript()
    expect(script.startsWith('@echo off\r\n')).toBe(true)
    expect(script.includes('\r\n')).toBe(true)
    expect(script).toContain('exit /b 0')
    // Why: jcode parses the hook command shell-style but executes it directly, so
    // the file has to be runnable on its own.
    expect(script).not.toContain('#!/bin/sh')
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
