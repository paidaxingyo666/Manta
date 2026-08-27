import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type * as WslPaths from '../../shared/wsl-paths'
import { createSettings } from './runtime-home-settings-test-fixtures'
import {
  createManagedAuth,
  createStore,
  setupRuntimeHomeTest,
  teardownRuntimeHomeTest,
  testState
} from './runtime-home-service-test-harness'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userDataDir
  }
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

describe('CodexRuntimeHomeService', () => {
  beforeEach(() => {
    setupRuntimeHomeTest()
  })

  afterEach(() => {
    teardownRuntimeHomeTest()
  })

  it('skips WSL session bridging when system default already uses its direct home', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const startWslCodexSessionBridgeInBackground = vi.fn(() => Promise.resolve())
    vi.doMock('../codex/wsl-codex-session-bridge', () => ({
      startWslCodexSessionBridgeInBackground
    }))
    const wslHome = join(testState.userDataDir, 'wsl-home')
    vi.doMock('../wsl', () => ({
      getDefaultWslDistro: () => 'Ubuntu',
      getWslHome: () => wslHome
    }))
    const wslSystemHomePath = join(wslHome, '.codex')
    mkdirSync(wslSystemHomePath, { recursive: true })
    writeFileSync(join(wslSystemHomePath, 'AGENTS.md'), '# WSL instructions\n', 'utf-8')
    const store = createStore(
      createSettings({
        activeCodexManagedAccountId: null,
        activeCodexManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: null } }
      })
    )

    try {
      const { CodexRuntimeHomeService } = await import('./runtime-home-service')
      const service = new CodexRuntimeHomeService(store as never)
      const wslRuntimeHomePath = join(
        wslHome,
        '.local',
        'share',
        'manta',
        'codex-runtime-home',
        'home'
      )

      expect(service.prepareForCodexLaunch({ runtime: 'wsl', wslDistro: 'Ubuntu' })).toBe(
        wslSystemHomePath
      )
      expect(startWslCodexSessionBridgeInBackground).not.toHaveBeenCalled()
      expect(readFileSync(join(wslSystemHomePath, 'AGENTS.md'), 'utf-8')).toBe(
        '# WSL instructions\n'
      )
      expect(existsSync(join(wslRuntimeHomePath, 'AGENTS.md'))).toBe(false)
    } finally {
      vi.doUnmock('../codex/wsl-codex-session-bridge')
      vi.doUnmock('../wsl')
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })

  it('keeps WSL in-Codex setting changes in the direct system home', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    vi.doMock('../codex/wsl-codex-session-bridge', () => ({
      startWslCodexSessionBridgeInBackground: vi.fn(() => Promise.resolve())
    }))
    const wslHome = join(testState.userDataDir, 'wsl-home')
    vi.doMock('../wsl', () => ({
      getDefaultWslDistro: () => 'Ubuntu',
      getWslHome: () => wslHome
    }))
    const store = createStore(
      createSettings({
        activeCodexManagedAccountId: null,
        activeCodexManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: null } }
      })
    )
    const wslSystemConfigPath = join(wslHome, '.codex', 'config.toml')
    mkdirSync(join(wslHome, '.codex'), { recursive: true })
    writeFileSync(wslSystemConfigPath, 'model = "gpt-5"\n', 'utf-8')

    try {
      const { CodexRuntimeHomeService } = await import('./runtime-home-service')
      const service = new CodexRuntimeHomeService(store as never)
      const wslRuntimeHomePath = join(
        wslHome,
        '.local',
        'share',
        'manta',
        'codex-runtime-home',
        'home'
      )

      expect(service.prepareForCodexLaunch({ runtime: 'wsl', wslDistro: 'Ubuntu' })).toBe(
        join(wslHome, '.codex')
      )
      const baselinePath = join(wslRuntimeHomePath, '.manta-config-settings-baseline.json')
      expect(existsSync(baselinePath)).toBe(false)

      writeFileSync(wslSystemConfigPath, 'model = "outside-edit"\n', 'utf-8')
      service.prepareForCodexLaunch({ runtime: 'wsl', wslDistro: 'Ubuntu' })
      expect(readFileSync(wslSystemConfigPath, 'utf-8')).toBe('model = "outside-edit"\n')

      writeFileSync(wslSystemConfigPath, 'model = "o4"\n', 'utf-8')
      service.prepareForCodexLaunch({ runtime: 'wsl', wslDistro: 'Ubuntu' })
      expect(readFileSync(wslSystemConfigPath, 'utf-8')).toBe('model = "o4"\n')
      expect(existsSync(baselinePath)).toBe(false)
    } finally {
      vi.doUnmock('../codex/wsl-codex-session-bridge')
      vi.doUnmock('../wsl')
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })

  it('bridges WSL history from a configured per-distro source-home override', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const startWslCodexSessionBridgeInBackground = vi.fn(() => Promise.resolve())
    vi.doMock('../codex/wsl-codex-session-bridge', () => ({
      startWslCodexSessionBridgeInBackground
    }))
    const wslHome = join(testState.userDataDir, 'wsl-home')
    vi.doMock('../wsl', () => ({
      getDefaultWslDistro: () => 'Ubuntu',
      getWslHome: () => wslHome
    }))
    const store = createStore(
      createSettings({
        activeCodexManagedAccountId: null,
        activeCodexManagedAccountIdsByRuntime: { host: null, wsl: { Ubuntu: null } },
        // Why: the override is a Linux path inside the distro, not <wslHome>/.codex.
        codexSessionSourceHome: { wsl: { Ubuntu: '/home/me/.config/codex' } }
      })
    )

    try {
      const { CodexRuntimeHomeService } = await import('./runtime-home-service')
      const service = new CodexRuntimeHomeService(store as never)
      service.prepareForCodexLaunch({ runtime: 'wsl', wslDistro: 'Ubuntu' })

      expect(startWslCodexSessionBridgeInBackground).toHaveBeenCalledTimes(1)
      expect(startWslCodexSessionBridgeInBackground).toHaveBeenCalledWith({
        distro: 'Ubuntu',
        systemCodexHomePath: '/home/me/.config/codex',
        managedCodexHomePath: join(wslHome, '.codex')
      })
    } finally {
      vi.doUnmock('../codex/wsl-codex-session-bridge')
      vi.doUnmock('../wsl')
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })

  it('starts WSL session bridging for the selected direct account home', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const startWslCodexSessionBridgeInBackground = vi.fn(() => Promise.resolve())
    vi.doMock('../codex/wsl-codex-session-bridge', () => ({
      startWslCodexSessionBridgeInBackground
    }))
    const wslHome = join(testState.userDataDir, 'debian-wsl-home')
    vi.doMock('../wsl', () => ({
      getDefaultWslDistro: () => null,
      getWslHome: (distro: string) => (distro === 'Debian' ? wslHome : null)
    }))
    vi.doMock('../../shared/wsl-paths', async (importOriginal) => {
      const actual = await importOriginal<typeof WslPaths>()
      return {
        ...actual,
        parseWslUncPath: (candidate: string) =>
          candidate.includes('codex-accounts/debian-account/home')
            ? {
                distro: 'Debian',
                linuxPath: '/home/alice/.local/share/manta/codex-accounts/debian-account/home'
              }
            : null
      }
    })
    const managedHomePath = createManagedAuth(
      testState.userDataDir,
      'debian-account',
      '{"account":"debian"}\n'
    )
    const store = createStore(
      createSettings({
        codexManagedAccounts: [
          {
            id: 'debian-account',
            email: 'debian@example.com',
            managedHomePath,
            managedHomeRuntime: 'wsl',
            wslDistro: 'Debian',
            wslLinuxHomePath: '/home/alice/.local/share/manta/codex-accounts/debian/home',
            providerAccountId: null,
            workspaceLabel: null,
            workspaceAccountId: null,
            createdAt: 1,
            updatedAt: 1,
            lastAuthenticatedAt: 1
          }
        ],
        activeCodexManagedAccountId: null,
        activeCodexManagedAccountIdsByRuntime: { host: null, wsl: { Debian: 'debian-account' } }
      })
    )

    try {
      const { CodexRuntimeHomeService } = await import('./runtime-home-service')
      const service = new CodexRuntimeHomeService(store as never)

      expect(service.prepareForCodexLaunch({ runtime: 'wsl', wslDistro: null })).toBe(
        managedHomePath
      )
      expect(startWslCodexSessionBridgeInBackground).toHaveBeenCalledWith({
        distro: 'Debian',
        systemCodexHomePath: join(wslHome, '.codex'),
        managedCodexHomePath: managedHomePath
      })
    } finally {
      vi.doUnmock('../codex/wsl-codex-session-bridge')
      vi.doUnmock('../wsl')
      vi.doUnmock('../../shared/wsl-paths')
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
    }
  })
})
