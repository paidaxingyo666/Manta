import { describe, expect, it, vi } from 'vitest'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import { reconcileRetainedCodexHookHomes } from './retained-codex-hook-state'

function status(state: 'installed' | 'not_installed' | 'error'): AgentHookInstallStatus {
  return {
    agent: 'codex',
    state,
    configPath: '/runtime/hooks.json',
    managedHooksPresent: state === 'installed',
    detail: state === 'error' ? 'failed' : null
  }
}

describe('retained Codex hook state', () => {
  it('repairs Manta hooks before a retained shell can launch Codex', () => {
    const install = vi.fn(() => status('installed'))
    const refreshRuntimeUserHooks = vi.fn(() => status('not_installed'))

    reconcileRetainedCodexHookHomes({
      hookService: { install, refreshRuntimeUserHooks },
      hooksEnabled: true,
      runtimeHomePaths: ['/manta/shared-home', '/manta/account-home']
    })

    expect(install).toHaveBeenCalledTimes(2)
    expect(install).toHaveBeenNthCalledWith(1, '/manta/shared-home')
    expect(install).toHaveBeenNthCalledWith(2, '/manta/account-home')
    expect(refreshRuntimeUserHooks).not.toHaveBeenCalled()
  })

  it('removes only Manta hooks from retained homes when hooks are disabled', () => {
    const install = vi.fn(() => status('installed'))
    const refreshRuntimeUserHooks = vi.fn(() => status('not_installed'))

    reconcileRetainedCodexHookHomes({
      hookService: { install, refreshRuntimeUserHooks },
      hooksEnabled: false,
      runtimeHomePaths: ['/manta/shared-home']
    })

    expect(refreshRuntimeUserHooks).toHaveBeenCalledWith('/manta/shared-home')
    expect(install).not.toHaveBeenCalled()
  })
})
