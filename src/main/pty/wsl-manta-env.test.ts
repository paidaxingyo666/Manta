import { describe, expect, it } from 'vitest'
import {
  SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV,
  SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV
} from '../../shared/setup-agent-sequencing'
import {
  addMantaWslInteropEnv,
  addWorktreeSetupWslInteropEnv,
  stampWslOrchestrationCompatibilityHost
} from './wsl-manta-env'

describe('addMantaWslInteropEnv', () => {
  it('marks the Manta terminal handle for Windows to WSL env import', () => {
    const env: Record<string, string> = { MANTA_TERMINAL_HANDLE: 'term_wsl' }

    addMantaWslInteropEnv(env)

    expect(env.WSLENV).toBe('MANTA_TERMINAL_HANDLE/u')
  })

  it('imports setup-gated startup env into WSL without path translation', () => {
    const env: Record<string, string> = {
      [SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]: 'codex',
      [SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV]: 'while :; do sleep 1; done'
    }

    addMantaWslInteropEnv(env)

    expect(env.WSLENV?.split(':')).toEqual([
      `${SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV}/u`,
      `${SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV}/u`
    ])
  })

  it('preserves existing WSLENV entries and does not duplicate the handle entry', () => {
    const env: Record<string, string> = {
      WSLENV: 'FOO/u:MANTA_TERMINAL_HANDLE/u:BAR/p'
    }

    addMantaWslInteropEnv(env)

    expect(env.WSLENV).toBe('FOO/u:MANTA_TERMINAL_HANDLE/u:BAR/p')
  })

  it('marks OMP status and hook env for Windows to WSL import', () => {
    const env: Record<string, string> = {
      MANTA_TERMINAL_HANDLE: 'term_wsl',
      MANTA_USER_DATA_PATH: 'C:\\Users\\jin\\AppData\\Roaming\\Manta',
      MANTA_CLI_COMMAND: 'manta-ide',
      MANTA_CODEX_LAUNCH_PREFLIGHT: 'C:\\Program Files\\Manta\\resources\\bin\\manta.exe',
      MANTA_OMP_STATUS_EXTENSION: 'C:\\Users\\jin\\.omp\\agent\\extensions\\manta-agent-status.ts',
      MANTA_PRIME_AGENT_STATUS_EXTENSION: 'C:\\stale\\manta-agent-status.ts',
      MANTA_PANE_KEY: 'tab-1:leaf-1',
      MANTA_TAB_ID: 'tab-1',
      MANTA_WORKTREE_ID: 'repo::\\\\wsl.localhost\\Ubuntu\\home\\jin\\repo',
      MANTA_AGENT_LAUNCH_TOKEN: 'launch-secret',
      MANTA_AGENT_HOOK_PORT: '4567',
      MANTA_AGENT_HOOK_TOKEN: 'token',
      MANTA_AGENT_HOOK_ENV: 'dev',
      MANTA_AGENT_HOOK_VERSION: '1',
      MANTA_WSL_HOOK_INSTANCE: 'testinstance',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'wsl',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'local',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'Ubuntu'
    }

    addMantaWslInteropEnv(env)

    expect(env.WSLENV).toContain('MANTA_TERMINAL_HANDLE/u')
    expect(env.WSLENV).toContain('MANTA_USER_DATA_PATH/p')
    expect(env.WSLENV).toContain('MANTA_CLI_COMMAND/u')
    expect(env.WSLENV).not.toContain('MANTA_CODEX_LAUNCH_PREFLIGHT')
    expect(env.WSLENV).toContain('MANTA_OMP_STATUS_EXTENSION/p')
    expect(env.WSLENV).not.toContain('MANTA_PRIME_AGENT_STATUS_EXTENSION')
    expect(env.WSLENV).toContain('MANTA_PANE_KEY/u')
    expect(env.WSLENV).toContain('MANTA_TAB_ID/u')
    expect(env.WSLENV).toContain('MANTA_WORKTREE_ID/u')
    expect(env.WSLENV).toContain('MANTA_AGENT_LAUNCH_TOKEN/u')
    expect(env.WSLENV).toContain('MANTA_AGENT_HOOK_PORT/u')
    expect(env.WSLENV).toContain('MANTA_AGENT_HOOK_TOKEN/u')
    expect(env.WSLENV).toContain('MANTA_AGENT_HOOK_ENV/u')
    expect(env.WSLENV).toContain('MANTA_AGENT_HOOK_VERSION/u')
    expect(env.WSLENV).toContain('MANTA_WSL_HOOK_INSTANCE/u')
    expect(env.WSLENV).toContain('MANTA_ORCHESTRATION_COMPATIBILITY_HOST_KIND/u')
    expect(env.WSLENV).toContain('MANTA_ORCHESTRATION_COMPATIBILITY_HOST_ID/u')
    expect(env.WSLENV).toContain('MANTA_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION/u')
  })

  it('overwrites caller host evidence with native runtime WSL authority', () => {
    const env = {
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'caller-host',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'caller-incarnation',
      MANTA_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'caller-attachment'
    }

    stampWslOrchestrationCompatibilityHost(env, 'local', 'Ubuntu')

    expect(env).toEqual({
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'wsl',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'local',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'Ubuntu'
    })
  })

  it('clears inherited host evidence outside a runtime-owned WSL scope', () => {
    const env = {
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'caller-host',
      MANTA_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'caller-incarnation',
      MANTA_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'caller-attachment'
    }

    stampWslOrchestrationCompatibilityHost(env, 'local', null)

    expect(env).toEqual({})
  })

  it('path-translates a Windows hook endpoint but passes a guest-side one untouched', () => {
    const windowsEnv: Record<string, string> = {
      MANTA_AGENT_HOOK_ENDPOINT:
        'C:\\Users\\jin\\AppData\\Roaming\\Manta\\agent-hooks\\endpoint.cmd'
    }
    addMantaWslInteropEnv(windowsEnv)
    expect(windowsEnv.WSLENV).toContain('MANTA_AGENT_HOOK_ENDPOINT/p')

    const guestEnv: Record<string, string> = {
      MANTA_AGENT_HOOK_ENDPOINT: '/home/jin/.manta-wsl/agent-hooks/port-4567/endpoint.env'
    }
    addMantaWslInteropEnv(guestEnv)
    expect(guestEnv.WSLENV).toContain('MANTA_AGENT_HOOK_ENDPOINT/u')
    expect(guestEnv.WSLENV).not.toContain('MANTA_AGENT_HOOK_ENDPOINT/p')
  })

  it('tags pre-translated Linux setup paths /u so WSLENV does not translate them again (#9206)', () => {
    const env: Record<string, string> = {
      MANTA_ROOT_PATH: '/home/jin/repo',
      MANTA_WORKTREE_PATH: '/home/jin/repo-worktrees/fix-1',
      MANTA_WORKSPACE_NAME: 'fix-1',
      CONDUCTOR_ROOT_PATH: '/home/jin/repo',
      GHOSTX_ROOT_PATH: '/home/jin/repo'
    }

    addMantaWslInteropEnv(env)

    // /u (not /p): hooks.ts already converted these to Linux paths before
    // spawn, so a /p flag would make WSLENV double-translate them.
    expect(env.WSLENV).toContain('MANTA_ROOT_PATH/u')
    expect(env.WSLENV).toContain('MANTA_WORKTREE_PATH/u')
    expect(env.WSLENV).toContain('CONDUCTOR_ROOT_PATH/u')
    expect(env.WSLENV).toContain('GHOSTX_ROOT_PATH/u')
    expect(env.WSLENV).not.toContain('MANTA_ROOT_PATH/p')
    expect(env.WSLENV).not.toContain('MANTA_WORKTREE_PATH/p')
    // The value itself must stay the already-Linux path.
    expect(env.MANTA_ROOT_PATH).toBe('/home/jin/repo')
    expect(env.MANTA_WORKTREE_PATH).toBe('/home/jin/repo-worktrees/fix-1')
  })

  it('tags untranslated Windows setup paths /p so WSLENV translates them (wsl.exe shell over a Windows worktree)', () => {
    const env: Record<string, string> = {
      MANTA_ROOT_PATH: 'C:\\Users\\jin\\repo',
      MANTA_WORKTREE_PATH: 'C:\\Users\\jin\\repo-worktrees\\fix-1',
      CONDUCTOR_ROOT_PATH: 'C:\\Users\\jin\\repo',
      GHOSTX_ROOT_PATH: 'C:\\Users\\jin\\repo'
    }

    addMantaWslInteropEnv(env)

    expect(env.WSLENV).toContain('MANTA_ROOT_PATH/p')
    expect(env.WSLENV).toContain('MANTA_WORKTREE_PATH/p')
    expect(env.WSLENV).toContain('CONDUCTOR_ROOT_PATH/p')
    expect(env.WSLENV).toContain('GHOSTX_ROOT_PATH/p')
    expect(env.WSLENV).not.toContain('MANTA_ROOT_PATH/u')
    expect(env.WSLENV).not.toContain('MANTA_WORKTREE_PATH/u')
  })

  it('always tags MANTA_WORKSPACE_NAME /u because it is a name, not a path', () => {
    const env: Record<string, string> = { MANTA_WORKSPACE_NAME: 'fix-1' }

    addMantaWslInteropEnv(env)

    expect(env.WSLENV).toBe('MANTA_WORKSPACE_NAME/u')
  })

  it('does not register setup vars that are absent from the env', () => {
    const env: Record<string, string> = { MANTA_TERMINAL_HANDLE: 'term_wsl' }

    addMantaWslInteropEnv(env)

    expect(env.WSLENV).toBe('MANTA_TERMINAL_HANDLE/u')
  })

  it('marks the WSL hook relay version for import on relay spawn envs', () => {
    const env: Record<string, string> = {
      MANTA_WSL_HOOK_RELAY_VERSION: '0.1.0+abc'
    }
    addMantaWslInteropEnv(env)
    expect(env.WSLENV).toBe('MANTA_WSL_HOOK_RELAY_VERSION/u')
  })

  it('crosses a guest-side OpenCode config overlay untranslated (/u)', () => {
    const env: Record<string, string> = {
      OPENCODE_CONFIG_DIR: '/home/jin/.manta-relay/opencode-overlays/abc',
      MANTA_OPENCODE_CONFIG_DIR: '/home/jin/.manta-relay/opencode-overlays/abc'
    }
    addMantaWslInteropEnv(env)
    expect(env.WSLENV).toContain('OPENCODE_CONFIG_DIR/u')
    expect(env.WSLENV).toContain('MANTA_OPENCODE_CONFIG_DIR/u')
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR/p')
  })

  it('never crosses a Windows OpenCode config dir into the guest', () => {
    // Why: the relay spawn env spreads process.env and the daemon inherits its
    // own — a /p entry here would deliver C:\... as /mnt/c and in-guest OpenCode
    // would adopt Manta's Windows overlay as its config root.
    const env: Record<string, string> = {
      OPENCODE_CONFIG_DIR: 'C:\\Users\\jin\\AppData\\Roaming\\Manta\\opencode-overlays\\abc',
      MANTA_OPENCODE_CONFIG_DIR: 'C:\\Users\\jin\\AppData\\Roaming\\Manta\\opencode-overlays\\abc'
    }
    addMantaWslInteropEnv(env)
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR')
    expect(env.WSLENV).not.toContain('MANTA_OPENCODE_CONFIG_DIR')
  })

  it('does not register the OpenCode config vars when they are absent', () => {
    const env: Record<string, string> = { MANTA_TERMINAL_HANDLE: 'term_wsl' }
    addMantaWslInteropEnv(env)
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR')
    expect(env.WSLENV).not.toContain('MANTA_OPENCODE_CONFIG_DIR')
  })
})

describe('addWorktreeSetupWslInteropEnv', () => {
  it('registers only setup vars, sharing the /u-vs-/p flag logic with the PTY path (#9206)', () => {
    const env: Record<string, string | undefined> = {
      MANTA_ROOT_PATH: '/mnt/c/Users/jin/repo',
      MANTA_WORKTREE_PATH: 'C:\\Users\\jin\\repo-worktrees\\fix-1',
      MANTA_WORKSPACE_NAME: 'fix-1',
      // Terminal-only vars must not leak into runHook's WSLENV.
      MANTA_TERMINAL_HANDLE: 'term_wsl'
    }

    addWorktreeSetupWslInteropEnv(env)

    expect(env.WSLENV).toBe('MANTA_ROOT_PATH/u:MANTA_WORKTREE_PATH/p:MANTA_WORKSPACE_NAME/u')
  })
})
