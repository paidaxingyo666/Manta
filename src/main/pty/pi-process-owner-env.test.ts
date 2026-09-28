import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDaemonPtyEnvironment,
  finalizeDaemonPtyEnvironment
} from '../daemon/pty-subprocess/spawn-environment'
import {
  createAgentStatusExtensionHarness,
  AGENT_STATUS_EXTENSION_SELF_PID
} from '../pi/agent-status-extension-test-harness'

const ownerEnv = {
  MANTA_PI_STATUS_OWNED: String(AGENT_STATUS_EXTENSION_SELF_PID - 1),
  MANTA_PRIME_AGENT_STATUS_OWNED: String(AGENT_STATUS_EXTENSION_SELF_PID - 1),
  ORCA_PI_TITLE_MARKER_OWNED: String(AGENT_STATUS_EXTENSION_SELF_PID - 1)
}
const terminalEnv = {
  MANTA_PANE_KEY: 'new-tab:new-leaf',
  MANTA_TAB_ID: 'new-tab',
  MANTA_WORKTREE_ID: 'folder:workspace',
  MANTA_AGENT_LAUNCH_TOKEN: 'new-launch',
  MANTA_AGENT_HOOK_PORT: '4321',
  MANTA_AGENT_HOOK_TOKEN: 'receiver-token',
  MANTA_PI_SOURCE_AGENT_DIR: 'user-config',
  KEEP_ME: 'terminal-value'
}

afterEach(() => vi.unstubAllEnvs())

describe('independent daemon terminal Pi ownership', () => {
  it.each(['pi', 'omp', 'prime-agent'] as const)(
    'lets %s register hooks without weakening suppression of its own children',
    async (kind) => {
      for (const [key, value] of Object.entries(ownerEnv)) {
        vi.stubEnv(key, value)
      }
      const env = createDaemonPtyEnvironment({
        sessionId: 'fresh-terminal',
        cols: 80,
        rows: 24,
        env: terminalEnv
      })

      for (const [key, value] of Object.entries(ownerEnv)) {
        expect(env[key]).toBeUndefined()
        expect(process.env[key]).toBe(value)
      }
      expect(env).toMatchObject(terminalEnv)

      const parent = createAgentStatusExtensionHarness({ kind, env })
      expect(parent.handlers.before_agent_start).toBeTypeOf('function')
      await parent.callHook('before_agent_start', { prompt: 'new turn' })
      expect(parent.fetchMock).toHaveBeenCalledOnce()

      const child = createAgentStatusExtensionHarness({
        kind,
        env: parent.processEnv,
        pid: AGENT_STATUS_EXTENSION_SELF_PID + 1
      })
      expect(child.handlers).toEqual({})
      parent.reload()
      expect(parent.handlers.before_agent_start).toBeTypeOf('function')
    }
  )

  it('drops process-local owners even when included in a new-terminal request', () => {
    const requestedEnv = { ...terminalEnv, ...ownerEnv }
    const env = createDaemonPtyEnvironment({
      sessionId: 'fresh-terminal',
      cols: 80,
      rows: 24,
      env: requestedEnv
    })
    for (const key of Object.keys(ownerEnv)) {
      expect(env[key]).toBeUndefined()
    }
    expect(env).toMatchObject(terminalEnv)
    expect(requestedEnv).toMatchObject(ownerEnv)
  })

  it('removes owners reintroduced while preparing the final shell environment', () => {
    const env = { ...terminalEnv, ...ownerEnv }
    finalizeDaemonPtyEnvironment(env, terminalEnv)
    for (const key of Object.keys(ownerEnv)) {
      expect(env).not.toHaveProperty(key)
    }
    expect(env).toMatchObject(terminalEnv)
  })
})
