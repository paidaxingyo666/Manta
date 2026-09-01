import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { upsertEphemeralVmRuntime } from '../../shared/ephemeral-vm-runtime-store'
import {
  makeDir,
  makePairingCode,
  makeStore,
  nodeCommand,
  removeMadeDirs
} from './ephemeral-vm-ipc-test-fixtures'

const handlers = new Map<string, (_event: unknown, args: never) => unknown>()
const { handleMock, getPathMock, invalidateRuntimeEnvironmentTransportMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  getPathMock: vi.fn(),
  invalidateRuntimeEnvironmentTransportMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))

vi.mock('../ephemeral-vm-runtime-ssh', () => ({
  connectRuntimeOwnedSshTarget: vi.fn(),
  disconnectRuntimeOwnedSshTarget: vi.fn(),
  removeRuntimeOwnedSshTarget: vi.fn()
}))

vi.mock('./runtime-environments', () => ({
  invalidateRuntimeEnvironmentTransport: invalidateRuntimeEnvironmentTransportMock
}))

import { registerEphemeralVmHandlers } from './ephemeral-vm'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function pluginServiceWithRecipes(
  recipes: { pluginKey: string; recipe: Record<string, unknown> }[]
) {
  return {
    whenReady: vi.fn().mockResolvedValue(undefined),
    contentPacks: { vmRecipes: { list: vi.fn(() => recipes) } }
  }
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  handlers.clear()
  handleMock.mockReset()
  getPathMock.mockReset()
  invalidateRuntimeEnvironmentTransportMock.mockReset()
  handleMock.mockImplementation((channel: string, handler: never) => {
    handlers.set(channel, handler)
  })
})

afterEach(() => {
  removeMadeDirs()
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

it('merges approved plugin recipes while repository recipes shadow matching ids', async () => {
  const repoPath = makeDir('manta-ephemeral-vm-ipc-repo-')
  writeFileSync(
    join(repoPath, 'manta.yaml'),
    [
      'environmentRecipes:',
      '  - id: shared',
      '    name: Repository Recipe',
      '    create: repo-create'
    ].join('\n')
  )
  const pluginService = pluginServiceWithRecipes([
    {
      pluginKey: 'manta-samples.recipes',
      recipe: { id: 'shared', name: 'Plugin Shared', create: 'plugin-shared' }
    },
    {
      pluginKey: 'manta-samples.recipes',
      recipe: { id: 'global', name: 'Plugin Global', create: 'plugin-global' }
    }
  ])

  registerEphemeralVmHandlers(makeStore(repoPath) as never, pluginService as never)
  const result = (await handlers.get('ephemeralVm:listRecipes')?.(null, {
    repoId: 'repo-1'
  } as never)) as { recipes: { id: string; name: string }[] }

  expect(pluginService.whenReady).toHaveBeenCalled()
  expect(result.recipes).toMatchObject([
    { id: 'shared', name: 'Repository Recipe' },
    { id: 'global', name: 'Plugin Global' }
  ])
})

it('uses an immutable plugin recipe snapshot after the plugin is removed', async () => {
  const userDataPath = makeDir('manta-ephemeral-vm-ipc-user-data-')
  const repoPath = makeDir('manta-ephemeral-vm-ipc-repo-')
  getPathMock.mockReturnValue(userDataPath)
  const startPath = join(repoPath, 'start.js')
  const destroyPath = join(repoPath, 'destroy.js')
  writeFileSync(
    startPath,
    `console.log(${JSON.stringify(
      JSON.stringify({
        schemaVersion: 1,
        pairingCode: makePairingCode(),
        projectRoot: '/workspace/repo'
      })
    )})`
  )
  writeFileSync(destroyPath, "require('fs').writeFileSync('plugin-cleaned.txt', 'yes')")
  const registrations = [
    {
      pluginKey: 'manta-samples.recipes',
      recipe: {
        id: 'plugin-cloud',
        name: 'Plugin Cloud',
        create: nodeCommand(startPath),
        destroy: nodeCommand(destroyPath)
      }
    }
  ]
  const pluginService = pluginServiceWithRecipes(registrations)
  registerEphemeralVmHandlers(makeStore(repoPath) as never, pluginService as never)

  const provisioned = (await handlers.get('ephemeralVm:provision')?.(null, {
    repoId: 'repo-1',
    recipeId: 'plugin-cloud'
  } as never)) as { ok: true; runtime: { id: string; recipe?: { id: string } } }
  registrations.splice(0)
  const cleaned = await handlers.get('ephemeralVm:cleanup')?.(null, {
    runtimeId: provisioned.runtime.id
  } as never)

  expect(provisioned.runtime.recipe).toMatchObject({ id: 'plugin-cloud' })
  expect(cleaned).toEqual(expect.objectContaining({ status: 'cleaned' }))
  expect(readFileSync(join(repoPath, 'plugin-cleaned.txt'), 'utf8')).toBe('yes')
})

it('never substitutes a later same-id plugin recipe for a legacy runtime', async () => {
  const userDataPath = makeDir('manta-ephemeral-vm-ipc-user-data-')
  const repoPath = makeDir('manta-ephemeral-vm-ipc-repo-')
  getPathMock.mockReturnValue(userDataPath)
  const pluginDestroyPath = join(repoPath, 'plugin-destroy.js')
  writeFileSync(
    pluginDestroyPath,
    "require('fs').writeFileSync('plugin-destroy-ran.txt', 'unsafe')"
  )
  upsertEphemeralVmRuntime(userDataPath, {
    id: 'legacy-runtime',
    recipeId: 'shared-id',
    repoId: 'repo-1',
    status: 'running',
    cleanupStatus: 'not_started',
    createdAt: 1,
    updatedAt: 1,
    recipeResult: {
      schemaVersion: 1,
      pairingCode: makePairingCode(),
      projectRoot: '/workspace/repo'
    }
  })
  const pluginService = pluginServiceWithRecipes([
    {
      pluginKey: 'manta-samples.recipes',
      recipe: {
        id: 'shared-id',
        name: 'Later Plugin Recipe',
        create: 'create',
        destroy: nodeCommand(pluginDestroyPath)
      }
    }
  ])
  registerEphemeralVmHandlers(makeStore(repoPath) as never, pluginService as never)

  const cleaned = await handlers.get('ephemeralVm:cleanup')?.(null, {
    runtimeId: 'legacy-runtime'
  } as never)

  expect(cleaned).toMatchObject({
    status: 'cleanup_failed',
    cleanupLastError: 'Recipe not found: shared-id'
  })
  expect(existsSync(join(repoPath, 'plugin-destroy-ran.txt'))).toBe(false)
})
