import { describe, expect, it, vi } from 'vitest'
import { parse as parseJsonc } from 'jsonc-parser'
import type { SFTPWrapper } from 'ssh2'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/manta-user-data'
  }
}))

import { CodexHookService } from '../codex/hook-service'
import { DroidHookService } from '../droid/hook-service'
import { CursorHookService } from '../cursor/hook-service'
import { CURSOR_EVENTS } from '../cursor/hook-events'
import { CommandCodeHookService } from '../command-code/hook-service'
import { GeminiHookService } from '../gemini/hook-service'
import { AntigravityHookService } from '../antigravity/hook-service'
import { AmpHookService } from '../amp/hook-service'
import { ClaudeHookService } from '../claude/hook-service'
import { GrokHookService } from '../grok/hook-service'
import { CopilotHookService } from '../copilot/hook-service'
import { DevinHookService } from '../devin/hook-service'
import { KimiHookService } from '../kimi/hook-service'
import { openClaudeHookService } from '../openclaude/hook-service'
import { createFakeSftp, EXPECTED_CURSOR_HOOK_RESPONSES } from './remote-hook-service-installers.test-fixtures'

describe('remote hook service installers', () => {
  it('always writes POSIX scripts for SSH remotes even from a Windows host', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const installers = [
        {
          path: '/home/dev/.manta/agent-hooks/claude-hook.sh',
          install: (sftp: SFTPWrapper) => new ClaudeHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/openclaude-hook.sh',
          install: (sftp: SFTPWrapper) => openClaudeHookService.installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/codex-hook.sh',
          install: (sftp: SFTPWrapper) => new CodexHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/gemini-hook.sh',
          install: (sftp: SFTPWrapper) => new GeminiHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/antigravity-hook.sh',
          install: (sftp: SFTPWrapper) =>
            new AntigravityHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.config/amp/plugins/manta-agent-status.ts',
          install: (sftp: SFTPWrapper) => new AmpHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/cursor-hook.sh',
          install: (sftp: SFTPWrapper) => new CursorHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/command-code-hook.sh',
          install: (sftp: SFTPWrapper) =>
            new CommandCodeHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/grok-hook.sh',
          install: (sftp: SFTPWrapper) => new GrokHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/copilot-hook.sh',
          install: (sftp: SFTPWrapper) => new CopilotHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/devin-hook.sh',
          install: (sftp: SFTPWrapper) => new DevinHookService().installRemote(sftp, '/home/dev')
        },
        {
          path: '/home/dev/.manta/agent-hooks/droid-hook.sh',
          install: (sftp: SFTPWrapper) => new DroidHookService().installRemote(sftp, '/home/dev')
        }
      ]

      for (const { install, path } of installers) {
        const { sftp, fs } = createFakeSftp()
        const status = await install(sftp)
        expect(status.state).toBe('installed')
        const script = fs.files.get(path)
        if (path.includes('/.config/amp/plugins/')) {
          expect(script).toContain('/hook/amp')
          expect(script).toContain("amp.on('agent.start'")
        } else {
          expect(script).toMatch(/^#!\/bin\/sh\n/)
        }
        expect(script).not.toContain('@echo off')
        expect(script).not.toContain('powershell -NoProfile')
      }
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })

  it('installs remote Codex hooks with matching trust entries', async () => {
    const { sftp, fs } = createFakeSftp({
      '/home/dev/.codex/hooks.json': `${JSON.stringify({
        hooks: {},
        _managed: {
          'external-manager': {
            Stop: [0]
          }
        }
      })}\n`
    })

    const status = await new CodexHookService().installRemote(sftp, '/home/dev/')

    expect(status.state).toBe('installed')
    expect(status.configPath).toBe('/home/dev/.codex/hooks.json')
    const hooks = JSON.parse(fs.files.get('/home/dev/.codex/hooks.json')!) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>
      _managed?: unknown
    }
    expect(hooks._managed).toEqual({ 'external-manager': { Stop: [0] } })
    for (const eventName of [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'Stop'
    ]) {
      const command = hooks.hooks[eventName]?.[0]?.hooks?.[0]?.command
      expect(command).toContain('/home/dev/.manta/agent-hooks/codex-hook.sh')
      expect(command).toMatch(/^if \[ -f /)
    }
    expect(fs.files.get('/home/dev/.manta/agent-hooks/codex-hook.sh')).toContain('#!/bin/sh')
    expect(fs.modes.get('/home/dev/.manta/agent-hooks/codex-hook.sh')).toBe(0o755)
    const toml = fs.files.get('/home/dev/.codex/config.toml')
    expect(toml).toContain('/home/dev/.codex/hooks.json:permission_request:0:0')
    expect(toml).toContain('trusted_hash = "sha256:')
  })

  it('reports Codex trust-write failures without rolling back installed hooks', async () => {
    const { sftp, fs } = createFakeSftp()
    fs.failRenameTo.add('/home/dev/.codex/config.toml')

    const status = await new CodexHookService().installRemote(sftp, '/home/dev')

    expect(status.state).toBe('error')
    expect(status.managedHooksPresent).toBe(true)
    expect(status.detail).toContain('trust entries could not be written')
    expect(fs.files.get('/home/dev/.codex/hooks.json')).toContain('codex-hook.sh')
    expect(fs.files.get('/home/dev/.manta/agent-hooks/codex-hook.sh')).toContain('#!/bin/sh')
  })

  it('installs Codex hooks into an explicit redirected CODEX_HOME', async () => {
    const runtimeHome = '/home/dev/.local/share/manta/codex-runtime-home/home'
    const { sftp, fs } = createFakeSftp({
      [`${runtimeHome}/config.toml`]: 'model = "gpt-5.2-codex"\n'
    })

    const status = await new CodexHookService().installRemote(sftp, '/home/dev', {
      codexHomeDir: runtimeHome,
      deferTrustUntilConfigToml: true
    })

    expect(status.state).toBe('installed')
    expect(status.configPath).toBe(`${runtimeHome}/hooks.json`)
    expect(fs.files.has('/home/dev/.codex/hooks.json')).toBe(false)
    const hooks = JSON.parse(fs.files.get(`${runtimeHome}/hooks.json`)!) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>
    }
    expect(hooks.hooks.Stop?.[0]?.hooks?.[0]?.command).toContain(
      '/home/dev/.local/share/manta/codex-runtime-home/home/.manta/agent-hooks/codex-hook.sh'
    )
    expect(fs.files.get(`${runtimeHome}/config.toml`)).toContain(
      `${runtimeHome}/hooks.json:stop:0:0`
    )
  })

  it('defers redirected Codex trust writes until config.toml exists', async () => {
    const runtimeHome = '/home/dev/.local/share/manta/codex-runtime-home/home'
    const { sftp, fs } = createFakeSftp()

    const status = await new CodexHookService().installRemote(sftp, '/home/dev', {
      codexHomeDir: runtimeHome,
      deferTrustUntilConfigToml: true
    })

    expect(status.state).toBe('installed')
    expect(status.detail).toContain('deferred')
    expect(fs.files.get(`${runtimeHome}/hooks.json`)).toContain('codex-hook.sh')
    expect(fs.files.has(`${runtimeHome}/config.toml`)).toBe(false)
  })

  it('installs remote Gemini, Antigravity, Cursor, Command Code, Grok, and Devin configs using their CLI-specific schemas', async () => {
    const gemini = createFakeSftp()
    const antigravity = createFakeSftp()
    const amp = createFakeSftp()
    const cursor = createFakeSftp()
    const commandCode = createFakeSftp()
    const grok = createFakeSftp()
    const devin = createFakeSftp({
      '/home/dev/.config/devin/config.json': `{
  // Existing Devin config comment
  "hooks": {},
  "permissions": { "mode": "normal" }
}
`
    })

    await new GeminiHookService().installRemote(gemini.sftp, '/home/dev')
    await new AntigravityHookService().installRemote(antigravity.sftp, '/home/dev')
    await new AmpHookService().installRemote(amp.sftp, '/home/dev')
    await new CursorHookService().installRemote(cursor.sftp, '/home/dev')
    await new CommandCodeHookService().installRemote(commandCode.sftp, '/home/dev')
    await new GrokHookService().installRemote(grok.sftp, '/home/dev')
    await new DevinHookService().installRemote(devin.sftp, '/home/dev')

    const geminiConfig = JSON.parse(gemini.fs.files.get('/home/dev/.gemini/settings.json')!) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>
    }
    for (const eventName of ['BeforeAgent', 'AfterAgent', 'AfterTool', 'BeforeTool']) {
      const command = geminiConfig.hooks[eventName]?.[0]?.hooks?.[0]?.command
      expect(command).toContain('/home/dev/.manta/agent-hooks/gemini-hook.sh')
      expect(command).toMatch(/^if \[ -f /)
    }
    expect(geminiConfig.hooks.PreToolUse).toBeUndefined()

    const antigravityConfig = JSON.parse(
      antigravity.fs.files.get('/home/dev/.gemini/config/hooks.json')!
    ) as {
      'manta-status': Record<
        string,
        { matcher?: string; command?: string; hooks?: { command: string }[] }[]
      >
    }
    for (const eventName of ['PreInvocation', 'PostInvocation', 'Stop']) {
      const command = antigravityConfig['manta-status'][eventName]?.[0]?.command
      expect(command).toContain('/home/dev/.manta/agent-hooks/antigravity-hook.sh')
      expect(command).toContain(`MANTA_ANTIGRAVITY_EVENT='${eventName}'`)
    }
    for (const eventName of ['PreToolUse', 'PostToolUse']) {
      const definition = antigravityConfig['manta-status'][eventName]?.[0]
      const command = definition?.hooks?.[0]?.command
      expect(definition?.matcher).toBe('*')
      expect(command).toContain('/home/dev/.manta/agent-hooks/antigravity-hook.sh')
      expect(command).toContain(`MANTA_ANTIGRAVITY_EVENT='${eventName}'`)
    }
    // Why: #2426 was an SSH report — a remote host missing the script must still answer the gate, not deny every tool.
    expect(antigravityConfig['manta-status'].PreToolUse[0].hooks?.[0]?.command).toContain(
      `printf '%s\\n' '{"decision":"ask"}'`
    )
    expect(antigravityConfig['manta-status'].PostToolUse[0].hooks?.[0]?.command).not.toContain(
      '{"decision"'
    )

    const ampPlugin = amp.fs.files.get('/home/dev/.config/amp/plugins/manta-agent-status.ts')
    expect(ampPlugin).toContain('/hook/amp')
    expect(ampPlugin).toContain("amp.on('tool.call'")
    expect(ampPlugin).toContain('return { action: "allow" }')

    const cursorConfig = JSON.parse(cursor.fs.files.get('/home/dev/.cursor/hooks.json')!) as {
      version: number
      hooks: Record<string, { command?: string; hooks?: unknown[] }[]>
    }
    expect(cursorConfig.version).toBe(1)
    for (const eventName of CURSOR_EVENTS) {
      const definition = cursorConfig.hooks[eventName]?.[0]
      const command = definition?.command
      expect(command).toContain('/home/dev/.manta/agent-hooks/cursor-hook.sh')
      expect(definition?.hooks).toBeUndefined()
      const response = EXPECTED_CURSOR_HOOK_RESPONSES[eventName]
      expect(command).toContain(`MANTA_CURSOR_HOOK_RESPONSE='${response}'`)
      expect(command).toContain(`printf '%s\\n' '${response}'`)
    }

    const commandCodeConfig = JSON.parse(
      commandCode.fs.files.get('/home/dev/.commandcode/settings.json')!
    ) as {
      hooks: Record<string, { matcher?: string; hooks?: { command: string }[] }[]>
    }
    for (const eventName of ['PreToolUse', 'PostToolUse', 'Stop']) {
      const definition = commandCodeConfig.hooks[eventName]?.[0]
      const command = definition?.hooks?.[0]?.command
      expect(command).toContain('/home/dev/.manta/agent-hooks/command-code-hook.sh')
      expect(command).toMatch(/^if \[ -f /)
    }
    expect(commandCodeConfig.hooks.PreToolUse?.[0]?.matcher).toBe('.*')
    expect(commandCodeConfig.hooks.PostToolUse?.[0]?.matcher).toBe('.*')
    expect(commandCodeConfig.hooks.Stop?.[0]?.matcher).toBeUndefined()

    const grokConfig = JSON.parse(
      grok.fs.files.get('/home/dev/.grok/hooks/manta-status.json')!
    ) as {
      hooks: Record<string, { matcher?: string; hooks?: { command: string }[] }[]>
    }
    for (const eventName of [
      'SessionStart',
      'UserPromptSubmit',
      'Stop',
      'StopFailure',
      'SessionEnd',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Notification'
    ]) {
      const definition = grokConfig.hooks[eventName]?.[0]
      const command = definition?.hooks?.[0]?.command
      expect(command).toContain('/home/dev/.manta/agent-hooks/grok-hook.sh')
      expect(command).toMatch(/^if \[ -n "\$MANTA_PANE_KEY" \] && /)
    }
    // Why: Grok tool matchers are real regexes; bare `*` is invalid match-all.
    expect(grokConfig.hooks.PreToolUse?.[0]?.matcher).toBe('.*')
    expect(grokConfig.hooks.PostToolUse?.[0]?.matcher).toBe('.*')
    expect(grokConfig.hooks.StopFailure?.[0]?.matcher).toBeUndefined()

    const devinText = devin.fs.files.get('/home/dev/.config/devin/config.json')!
    // Why: Devin config.json is JSONC — parse it as such, and assert the user's comment
    // survived. Asserting with JSON.parse would only pass if the install had stripped it.
    expect(devinText).toContain('// Existing Devin config comment')
    const devinConfig = parseJsonc(devinText) as {
      permissions: { mode: string }
      hooks: Record<string, { matcher?: string; hooks?: { command: string }[] }[]>
    }
    expect(devinConfig.permissions.mode).toBe('normal')
    for (const eventName of [
      'SessionStart',
      'UserPromptSubmit',
      'Stop',
      'PostCompaction',
      'SessionEnd'
    ]) {
      const definition = devinConfig.hooks[eventName]?.[0]
      const command = definition?.hooks?.[0]?.command
      expect(command).toContain('/home/dev/.manta/agent-hooks/devin-hook.sh')
      expect(command).toMatch(/^if \[ -f /)
    }
    for (const eventName of ['PreToolUse', 'PostToolUse', 'PermissionRequest']) {
      const definition = devinConfig.hooks[eventName]?.[0]
      const command = definition?.hooks?.[0]?.command
      expect(definition?.matcher).toBeUndefined()
      expect(command).toContain('/home/dev/.manta/agent-hooks/devin-hook.sh')
      expect(command).toMatch(/^if \[ -f /)
    }
    expect(devin.fs.files.get('/home/dev/.manta/agent-hooks/devin-hook.sh')).toContain(
      '/hook/devin'
    )
  })

  it('installs remote Grok config in the explicit guest GROK_HOME', async () => {
    const { sftp, fs } = createFakeSftp()

    const status = await new GrokHookService().installRemote(
      sftp,
      '/home/dev',
      '/srv/grok profile/'
    )

    expect(status.configPath).toBe('/srv/grok profile/hooks/manta-status.json')
    expect(fs.files.has('/srv/grok profile/hooks/manta-status.json')).toBe(true)
    expect(fs.files.has('/home/dev/.grok/hooks/manta-status.json')).toBe(false)
    const script = fs.files.get('/home/dev/.manta/agent-hooks/grok-hook.sh')!
    expect(script).toContain('${#GROK_HOME}" -le 4096')
    expect(script).toContain('--data-urlencode "grokHome=${grok_home}"')
  })

  it.each(['relative/grok', '/bad\\grok', `/${'x'.repeat(4096)}`])(
    'falls back to login-home Grok config for invalid remote home %s',
    async (remoteGrokHome) => {
      const { sftp, fs } = createFakeSftp()

      const status = await new GrokHookService().installRemote(sftp, '/home/dev', remoteGrokHome)

      expect(status.configPath).toBe('/home/dev/.grok/hooks/manta-status.json')
      expect(fs.files.has('/home/dev/.grok/hooks/manta-status.json')).toBe(true)
    }
  )

  it('installs remote Kimi hooks as a managed config.toml block preserving user config', async () => {
    const userConfig = 'default_model = "kimi-k2.6"\n\n[providers."mine"]\napi_key = "sk-secret"\n'
    const { sftp, fs } = createFakeSftp({ '/home/dev/.kimi-code/config.toml': userConfig })

    const status = await new KimiHookService().installRemote(sftp, '/home/dev')
    expect(status.state).toBe('installed')

    const config = fs.files.get('/home/dev/.kimi-code/config.toml')!
    // User config above the managed block is preserved.
    expect(config).toContain('default_model = "kimi-k2.6"')
    expect(config).toContain('api_key = "sk-secret"')
    for (const eventName of [
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionRequest',
      'Stop',
      'StopFailure'
    ]) {
      expect(config).toContain(`event = "${eventName}"`)
    }
    // The command points at the POSIX managed script via the regular-file guard.
    expect(config).toContain('/home/dev/.manta/agent-hooks/kimi-hook.sh')
    expect(config).toMatch(/command = "if \[ -f /)
    expect(fs.files.get('/home/dev/.manta/agent-hooks/kimi-hook.sh')).toContain('/hook/kimi')
  })

  it('does not overwrite malformed remote Devin JSONC', async () => {
    const original = '{"hooks": }'
    const { sftp, fs } = createFakeSftp({
      '/home/dev/.config/devin/config.json': original
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const status = await new DevinHookService().installRemote(sftp, '/home/dev')

      expect(status).toMatchObject({
        agent: 'devin',
        state: 'error',
        configPath: '/home/dev/.config/devin/config.json',
        managedHooksPresent: false,
        detail: 'Could not parse remote Devin config.json'
      })
      expect(fs.files.get('/home/dev/.config/devin/config.json')).toBe(original)
      expect(fs.files.get('/home/dev/.manta/agent-hooks/devin-hook.sh')).toBeUndefined()
    } finally {
      warn.mockRestore()
    }
  })

  it('replaces stale remote Antigravity PreToolUse hooks while installing SSH hooks', async () => {
    const { sftp, fs } = createFakeSftp()
    fs.files.set(
      '/home/dev/.gemini/config/hooks.json',
      `${JSON.stringify(
        {
          'manta-status': {
            PreToolUse: [
              {
                matcher: '*',
                hooks: [
                  {
                    type: 'command',
                    command: '/tmp/old/agent-hooks/antigravity-hook.sh'
                  }
                ]
              }
            ],
            PostToolUse: [
              {
                matcher: '*',
                hooks: [
                  {
                    type: 'command',
                    command: 'echo user-authored'
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

    await new AntigravityHookService().installRemote(sftp, '/home/dev')

    const config = JSON.parse(fs.files.get('/home/dev/.gemini/config/hooks.json')!) as {
      'manta-status': Record<string, { hooks?: { command: string }[] }[]>
    }
    const preToolCommands = config['manta-status'].PreToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(preToolCommands).toHaveLength(1)
    expect(preToolCommands[0]).toContain('/home/dev/.manta/agent-hooks/antigravity-hook.sh')
    expect(preToolCommands).not.toContain('/tmp/old/agent-hooks/antigravity-hook.sh')
    const postToolCommands = config['manta-status'].PostToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(postToolCommands).toContain('echo user-authored')
    expect(postToolCommands.some((command) => command.includes('antigravity-hook.sh'))).toBe(true)
  })
})
