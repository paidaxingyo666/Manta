import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/manta-user-data'
  }
}))

import { codexHookService } from '../codex/hook-service'
import { DroidHookService, droidHookService } from '../droid/hook-service'
import { cursorHookService } from '../cursor/hook-service'
import { commandCodeHookService } from '../command-code/hook-service'
import { GeminiHookService, geminiHookService } from '../gemini/hook-service'
import { antigravityHookService } from '../antigravity/hook-service'
import { AmpHookService, ampHookService } from '../amp/hook-service'
import { claudeHookService } from '../claude/hook-service'
import { grokHookService } from '../grok/hook-service'
import { CopilotHookService, copilotHookService } from '../copilot/hook-service'
import { HermesHookService, hermesHookService } from '../hermes/hook-service'
import { devinHookService } from '../devin/hook-service'
import { kimiHookService } from '../kimi/hook-service'
import { openClaudeHookService } from '../openclaude/hook-service'
import { MANAGED_AGENT_HOOK_INSTALLERS } from './managed-agent-hook-controls'
import { installRemoteManagedAgentHooks, REMOTE_MANAGED_HOOK_INSTALLER_AGENTS } from './remote-managed-hook-installers'
import { createFakeSftp } from './remote-hook-service-installers.test-fixtures'

describe('remote hook service installers, provider matrix', () => {
  it('removes stale remote Gemini PreToolUse hooks while preserving user-authored hooks', async () => {
    const { sftp, fs } = createFakeSftp()
    fs.files.set(
      '/home/dev/.gemini/settings.json',
      `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  {
                    type: 'command',
                    command:
                      "if [ -x '/tmp/old/agent-hooks/gemini-hook.sh' ]; then /bin/sh '/tmp/old/agent-hooks/gemini-hook.sh'; fi"
                  }
                ]
              },
              {
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

    await new GeminiHookService().installRemote(sftp, '/home/dev')

    const config = JSON.parse(fs.files.get('/home/dev/.gemini/settings.json')!) as {
      hooks: Record<string, { hooks?: { command: string }[] }[]>
    }
    const preToolCommands = config.hooks.PreToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(preToolCommands).toEqual(['echo user-authored'])
    const beforeToolCommands = config.hooks.BeforeTool.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(beforeToolCommands.some((command) => command.includes('gemini-hook.sh'))).toBe(true)
  })

  it('installs remote Copilot hooks under the user-level hooks directory', async () => {
    const { sftp, fs } = createFakeSftp()
    fs.dirs.add('/home/dev/.copilot')
    fs.dirs.add('/home/dev/.copilot/hooks')
    fs.files.set(
      '/home/dev/.copilot/hooks/manta.json',
      JSON.stringify({
        version: 99,
        disableAllHooks: true,
        hooks: {}
      })
    )

    const status = await new CopilotHookService().installRemote(sftp, '/home/dev/')

    expect(status.state).toBe('installed')
    expect(status.configPath).toBe('/home/dev/.copilot/hooks/manta.json')
    const config = JSON.parse(fs.files.get('/home/dev/.copilot/hooks/manta.json')!) as {
      version: number
      disableAllHooks?: boolean
      hooks: Record<string, { bash?: string; timeoutSec?: number }[]>
    }
    expect(config.version).toBe(1)
    for (const eventName of [
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'subagentStart',
      'SubagentStop',
      'PreCompact',
      'Stop',
      'ErrorOccurred',
      'PermissionRequest',
      'Notification'
    ]) {
      const definition = config.hooks[eventName]?.[0]
      expect(definition?.bash).toContain('/home/dev/.manta/agent-hooks/copilot-hook.sh')
      expect(definition?.bash).toContain(`MANTA_COPILOT_HOOK_EVENT='${eventName}'`)
      expect(definition?.timeoutSec).toBe(5)
    }
    expect(config.disableAllHooks).toBeUndefined()
    expect(fs.files.get('/home/dev/.manta/agent-hooks/copilot-hook.sh')).toContain('#!/bin/sh')
    expect(fs.modes.get('/home/dev/.manta/agent-hooks/copilot-hook.sh')).toBe(0o755)
  })

  // Why: Droid (and Copilot) each shipped a working installRemote but were never
  // registered in REMOTE_MANAGED_HOOK_INSTALLERS, so their status silently never
  // appeared over SSH (issue #7253). Guard the whole bug class, not one agent:
  // every locally-managed hook service that implements installRemote MUST be
  // wired into the remote installer.
  it('registers every managed agent that implements installRemote in the remote installer (issue #7253)', () => {
    const servicesByAgent = new Map<string, { installRemote?: unknown }>([
      ['claude', claudeHookService],
      ['openclaude', openClaudeHookService],
      ['codex', codexHookService],
      ['gemini', geminiHookService],
      ['antigravity', antigravityHookService],
      ['amp', ampHookService],
      ['cursor', cursorHookService],
      ['droid', droidHookService],
      ['command-code', commandCodeHookService],
      ['grok', grokHookService],
      ['copilot', copilotHookService],
      ['hermes', hermesHookService],
      ['devin', devinHookService],
      ['kimi', kimiHookService]
    ])

    // Guard against a service silently missing from the map above as new agents land.
    for (const [agent] of MANAGED_AGENT_HOOK_INSTALLERS) {
      expect(servicesByAgent.has(agent)).toBe(true)
    }

    const registered = new Set<string>(REMOTE_MANAGED_HOOK_INSTALLER_AGENTS)
    const missing: string[] = []
    for (const [agent, service] of servicesByAgent) {
      if (typeof service.installRemote === 'function' && !registered.has(agent)) {
        missing.push(agent)
      }
    }
    expect(missing).toEqual([])
  })

  it('installs Droid and Copilot when running the aggregate remote installer (issue #7253)', async () => {
    const { sftp } = createFakeSftp()
    const results = await installRemoteManagedAgentHooks(sftp, '/home/dev', {
      agents: REMOTE_MANAGED_HOOK_INSTALLER_AGENTS
    })
    const byAgent = new Map(results.map((r) => [r.agent, r.state]))
    expect(byAgent.get('droid')).toBe('installed')
    expect(byAgent.get('copilot')).toBe('installed')
  })

  it('installs only positively detected remote agents', async () => {
    const { sftp, fs } = createFakeSftp()

    const results = await installRemoteManagedAgentHooks(sftp, '/home/dev', {
      agents: ['codex']
    })

    expect(results.map((result) => result.agent)).toEqual(['codex'])
    const paths = [...fs.files.keys(), ...fs.dirs]
    for (const unusedHome of ['.factory', '.gemini', '.grok', '.hermes', '.commandcode']) {
      expect(paths.some((path) => path.includes(`/home/dev/${unusedHome}`))).toBe(false)
    }
  })

  it('fails closed when the agent allowlist is omitted or empty (issue #11641)', async () => {
    const { sftp, fs } = createFakeSftp()

    await expect(installRemoteManagedAgentHooks(sftp, '/home/dev')).resolves.toEqual([])
    await expect(
      installRemoteManagedAgentHooks(sftp, '/home/dev', { agents: [] })
    ).resolves.toEqual([])

    // Why: fake SFTP seeds '/' only; no agent config homes or files may appear.
    expect([...fs.files.keys()]).toEqual([])
    expect([...fs.dirs]).toEqual(['/'])
  })

  it('stops before the next installer when its relay request is cancelled', async () => {
    const controller = new AbortController()
    const claudeInstall = vi
      .spyOn(claudeHookService, 'installRemote')
      .mockImplementation(async () => {
        controller.abort()
        return {
          agent: 'claude',
          state: 'installed',
          configPath: '/home/dev/.claude/settings.json',
          managedHooksPresent: true,
          detail: null
        }
      })
    const openClaudeInstall = vi.spyOn(openClaudeHookService, 'installRemote')
    try {
      const { sftp } = createFakeSftp()

      await expect(
        installRemoteManagedAgentHooks(sftp, '/home/dev', {
          signal: controller.signal,
          agents: REMOTE_MANAGED_HOOK_INSTALLER_AGENTS
        })
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(claudeInstall).toHaveBeenCalledTimes(1)
      expect(openClaudeInstall).not.toHaveBeenCalled()
    } finally {
      claudeInstall.mockRestore()
      openClaudeInstall.mockRestore()
    }
  })

  it('installs remote Droid hooks into Factory settings.json (issue #7253)', async () => {
    const { sftp, fs } = createFakeSftp()

    const status = await new DroidHookService().installRemote(sftp, '/home/dev')

    expect(status.state).toBe('installed')
    expect(status.configPath).toBe('/home/dev/.factory/settings.json')
    const config = JSON.parse(fs.files.get('/home/dev/.factory/settings.json')!) as {
      hooks: Record<string, { matcher?: string; hooks?: { command: string }[] }[]>
    }
    for (const eventName of [
      'SessionStart',
      'UserPromptSubmit',
      'Stop',
      'SubagentStop',
      'PreToolUse',
      'PostToolUse',
      'PermissionRequest',
      'Notification'
    ]) {
      const definition = config.hooks[eventName]?.[0]
      const command = definition?.hooks?.[0]?.command
      expect(command).toContain('/home/dev/.manta/agent-hooks/droid-hook.sh')
      expect(command).toMatch(/^if \[ -f /)
    }
    // Tool/permission events carry a `*` matcher; lifecycle events do not.
    expect(config.hooks.PreToolUse?.[0]?.matcher).toBe('*')
    expect(config.hooks.PostToolUse?.[0]?.matcher).toBe('*')
    expect(config.hooks.PermissionRequest?.[0]?.matcher).toBe('*')
    expect(config.hooks.Stop?.[0]?.matcher).toBeUndefined()
    const script = fs.files.get('/home/dev/.manta/agent-hooks/droid-hook.sh')
    expect(script).toContain('#!/bin/sh')
    expect(script).toContain('/hook/droid')
    expect(fs.modes.get('/home/dev/.manta/agent-hooks/droid-hook.sh')).toBe(0o755)
  })

  it('does not overwrite a malformed remote Factory settings.json', async () => {
    const original = '{"hooks": }'
    const { sftp, fs } = createFakeSftp({
      '/home/dev/.factory/settings.json': original
    })

    const status = await new DroidHookService().installRemote(sftp, '/home/dev')

    expect(status).toMatchObject({
      agent: 'droid',
      state: 'error',
      configPath: '/home/dev/.factory/settings.json',
      managedHooksPresent: false,
      detail: 'Could not parse remote Factory settings.json'
    })
    expect(fs.files.get('/home/dev/.factory/settings.json')).toBe(original)
    expect(fs.files.get('/home/dev/.manta/agent-hooks/droid-hook.sh')).toBeUndefined()
  })

  it('installs remote Hermes plugin files and enables the plugin', async () => {
    const { sftp, fs } = createFakeSftp()

    const status = await new HermesHookService().installRemote(sftp, '/home/dev')

    expect(status.state).toBe('installed')
    expect(status.configPath).toBe('/home/dev/.hermes/config.yaml')
    expect(fs.files.get('/home/dev/.hermes/plugins/manta-status/plugin.yaml')).toContain(
      'pre_llm_call'
    )
    expect(fs.files.get('/home/dev/.hermes/plugins/manta-status/__init__.py')).toContain(
      '/hook/hermes'
    )
    expect(fs.files.get('/home/dev/.hermes/config.yaml')).toContain('manta-status')
  })

  it('does not overwrite a remote user-authored Amp plugin file', async () => {
    const { sftp, fs } = createFakeSftp({
      '/home/dev/.config/amp/plugins/manta-agent-status.ts':
        'export default function userPlugin() {}\n'
    })

    const status = await new AmpHookService().installRemote(sftp, '/home/dev/')

    expect(status).toMatchObject({
      agent: 'amp',
      state: 'partial',
      managedHooksPresent: false
    })
    expect(fs.files.get('/home/dev/.config/amp/plugins/manta-agent-status.ts')).toBe(
      'export default function userPlugin() {}\n'
    )
  })
})
