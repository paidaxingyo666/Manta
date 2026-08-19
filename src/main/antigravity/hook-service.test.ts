import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as Record<string, unknown>
  return {
    ...actual,
    homedir: homedirMock
  }
})

import { AntigravityHookService } from './hook-service'
import { POSIX_HOOK_STDIN_READER } from '../agent-hooks/hook-stdin-contract'
import { createManagedCommandMatcher } from '../agent-hooks/installer-utils'

const ANTIGRAVITY_SCRIPT_FILE_NAME =
  process.platform === 'win32' ? 'antigravity-hook.cmd' : 'antigravity-hook.sh'
const ANTIGRAVITY_PRE_INVOCATION_COMMAND =
  process.platform === 'win32' ? 'antigravity-pre-invocation.cmd' : 'antigravity-hook.sh'
const ANTIGRAVITY_POST_TOOL_USE_COMMAND =
  process.platform === 'win32' ? 'antigravity-post-tool-use.cmd' : 'antigravity-hook.sh'

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return run()
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  }
}

describe('AntigravityHookService', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'manta-antigravity-home-'))
    homedirMock.mockReturnValue(homeDir)
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('installs Antigravity global hooks.json bundle and managed script', () => {
    const status = new AntigravityHookService().install()

    expect(status.state).toBe('installed')
    expect(status.configPath).toBe(join(homeDir, '.gemini', 'config', 'hooks.json'))
    expect(status.managedHooksPresent).toBe(true)

    const config = JSON.parse(
      readFileSync(join(homeDir, '.gemini', 'config', 'hooks.json'), 'utf8')
    ) as {
      'manta-status': Record<
        string,
        { matcher?: string; command?: string; hooks?: { command: string }[] }[]
      >
    }
    expect(Object.keys(config['manta-status']).sort()).toEqual(
      ['PostInvocation', 'PostToolUse', 'PreInvocation', 'Stop'].sort()
    )
    expect(config['manta-status'].PreToolUse).toBeUndefined()
    expect(config['manta-status'].PostToolUse[0].matcher).toBe('*')
    expect(config['manta-status'].PreInvocation[0].command).toContain(
      ANTIGRAVITY_PRE_INVOCATION_COMMAND
    )
    if (process.platform === 'win32') {
      expect(config['manta-status'].PreInvocation[0].command).not.toContain(
        'MANTA_ANTIGRAVITY_EVENT'
      )
    } else {
      expect(config['manta-status'].PreInvocation[0].command).toContain(
        "MANTA_ANTIGRAVITY_EVENT='PreInvocation'"
      )
      expect(config['manta-status'].Stop[0].command).toContain("MANTA_ANTIGRAVITY_EVENT='Stop'")
    }

    const script = readFileSync(
      join(homeDir, '.manta', 'agent-hooks', ANTIGRAVITY_SCRIPT_FILE_NAME),
      'utf8'
    )
    expect(script).toContain('/hook/antigravity')
    if (process.platform === 'win32') {
      expect(script).toContain('%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
      expect(script).toContain('hook_event_name=$env:MANTA_ANTIGRAVITY_EVENT')
      expect(script).toContain('[string]::IsNullOrWhiteSpace($inputData)) { @{} }')
      expect(script).not.toContain('[string]::IsNullOrWhiteSpace($inputData)) { exit 0 }')
    } else {
      expect(script).toContain('hook_event_name=${MANTA_ANTIGRAVITY_EVENT}')
      expect(script).toContain(`payload=$(${POSIX_HOOK_STDIN_READER})`)
      expect(script).toContain("payload='{}'")
      expect(script).not.toContain('if [ -z "$payload" ]; then\n  exit 0\nfi')
      // Why: payload is piped to curl via stdin (`payload@-`) so it never lands
      // on the curl command line (EDR oversized-command-line false positive).
      expect(script).toContain('printf \'%s\' "$payload" | curl')
      expect(script).toContain('--data-urlencode "payload@-"')
      expect(script).not.toContain('--data-urlencode "payload=${payload}"')
    }
    expect(script).toContain('{"decision":""}')
  })

  it('installs Windows event wrappers without nested cmd quoting and removes stale PreToolUse hooks', () => {
    withPlatform('win32', () => {
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      const staleScriptPath = join(
        homeDir,
        '.manta',
        'agent-hooks',
        'antigravity-hook.cmd'
      ).replaceAll('/', '\\')
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(
        configPath,
        `${JSON.stringify(
          {
            'manta-status': {
              PreToolUse: [
                {
                  matcher: '*',
                  hooks: [
                    {
                      type: 'command',
                      command: `cmd /d /s /c "set "MANTA_ANTIGRAVITY_EVENT=PreToolUse" && call "${staleScriptPath}""`
                    }
                  ]
                }
              ]
            }
          },
          null,
          2
        )}\n`
      )

      const service = new AntigravityHookService()
      const staleStatus = service.getStatus()
      expect(staleStatus.state).toBe('partial')
      expect(staleStatus.managedHooksPresent).toBe(true)

      const status = service.install()

      expect(status.state).toBe('installed')

      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        'manta-status': Record<
          string,
          { matcher?: string; command?: string; hooks?: { command: string }[] }[]
        >
      }
      expect(config['manta-status'].PreToolUse).toBeUndefined()

      const expectedWrappers = {
        PreInvocation: 'antigravity-pre-invocation.cmd',
        PostInvocation: 'antigravity-post-invocation.cmd',
        Stop: 'antigravity-stop.cmd',
        PostToolUse: 'antigravity-post-tool-use.cmd'
      }
      for (const [eventName, wrapperFileName] of Object.entries(expectedWrappers)) {
        const definition = config['manta-status'][eventName][0]
        const command =
          eventName === 'PostToolUse' ? definition.hooks?.[0]?.command : definition.command
        expect(createManagedCommandMatcher(wrapperFileName)(command)).toBe(true)
        expect(command).not.toContain('cmd /d /s /c')
        expect(command).not.toContain('MANTA_ANTIGRAVITY_EVENT')

        const wrapper = readFileSync(
          join(homeDir, '.manta', 'agent-hooks', wrapperFileName),
          'utf8'
        )
        expect(wrapper).toContain(`set "MANTA_ANTIGRAVITY_EVENT=${eventName}"`)
        expect(wrapper).toContain('call "%MANTA_ANTIGRAVITY_CORE%"')
      }

      const script = readFileSync(
        join(homeDir, '.manta', 'agent-hooks', 'antigravity-hook.cmd'),
        'utf8'
      )
      expect(script).toContain('/hook/antigravity')
      expect(script).toContain('%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
      expect(script).toContain('hook_event_name=$env:MANTA_ANTIGRAVITY_EVENT')
      expect(script).toContain('[string]::IsNullOrWhiteSpace($inputData)) { @{} }')
      expect(script).not.toContain('[string]::IsNullOrWhiteSpace($inputData)) { exit 0 }')
    })
  })

  it('preserves user-authored hook bundles and entries in Manta bundle', () => {
    const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          'user-hook': {
            PreInvocation: [{ type: 'command', command: '/usr/local/bin/user-hook' }]
          },
          'manta-status': {
            PreInvocation: [{ type: 'command', command: '/usr/local/bin/manta-extra' }]
          }
        },
        null,
        2
      )}\n`
    )

    new AntigravityHookService().install()

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      'user-hook': { PreInvocation: { command: string }[] }
      'manta-status': { PreInvocation: { command: string }[] }
    }
    expect(config['user-hook'].PreInvocation[0].command).toBe('/usr/local/bin/user-hook')
    const commands = config['manta-status'].PreInvocation.map((entry) => entry.command)
    expect(commands).toContain('/usr/local/bin/manta-extra')
    expect(commands.some((command) => command.includes(ANTIGRAVITY_PRE_INVOCATION_COMMAND))).toBe(
      true
    )
  })

  it('removes stale managed Antigravity hook entries from retired events', () => {
    const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          'manta-status': {
            OldEvent: [
              {
                type: 'command',
                command: '/tmp/old/agent-hooks/antigravity-hook.sh'
              }
            ],
            PreToolUse: [
              {
                matcher: '*',
                hooks: [{ type: 'command', command: '/tmp/old/agent-hooks/antigravity-hook.sh' }]
              }
            ]
          }
        },
        null,
        2
      )}\n`
    )

    new AntigravityHookService().install()

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      'manta-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
    }
    expect(config['manta-status'].OldEvent).toBeUndefined()
    expect(config['manta-status'].PreToolUse).toBeUndefined()
    const commands = config['manta-status'].PostToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain(
      join(homeDir, '.manta', 'agent-hooks', ANTIGRAVITY_POST_TOOL_USE_COMMAND)
    )
  })
})
