import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'

vi.mock('electron', () => ({
  app: { isPackaged: true }
}))

import { resolveAppImageLauncherEndpointPath } from './appimage-stable-launcher'
import { ensureLinuxTerminalMantaCliShimDir } from './linux-terminal-manta-cli-shim'

const created: string[] = []
const canFenceAppImageRuntime = process.platform === 'linux' && existsSync('/proc/self/stat')

async function makeFixture(): Promise<{ userDataPath: string; resourcesPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'manta-terminal-cli-shim-'))
  created.push(root)
  const resourcesPath = join(root, 'resources')
  // The bundled manta-ide launcher must exist for the shim to be written.
  mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
  writeFileSync(join(resourcesPath, 'bin', 'manta-ide'), '#!/usr/bin/env bash\n', 'utf8')
  return { userDataPath: join(root, 'user-data'), resourcesPath }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ensureLinuxTerminalMantaCliShimDir', () => {
  it('uses the mounted bundled launcher when only APPDIR is inherited', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    vi.stubEnv('APPIMAGE', '')
    vi.stubEnv('APPDIR', resourcesPath)

    const shimDir = ensureLinuxTerminalMantaCliShimDir({ userDataPath, resourcesPath })

    expect(shimDir).toBe(join(userDataPath, 'linux-manta-cli-shim'))
    expect(readFileSync(join(shimDir!, 'manta'), 'utf8')).toContain(
      `exec '${join(resourcesPath, 'bin', 'manta-ide')}' "$@"`
    )
  })

  it('writes an executable bare-manta shim that execs the bundled manta-ide launcher', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()

    const shimDir = ensureLinuxTerminalMantaCliShimDir({
      userDataPath,
      resourcesPath,
      appImagePath: null
    })

    expect(shimDir).toBe(join(userDataPath, 'linux-manta-cli-shim'))
    const content = readFileSync(join(shimDir!, 'manta'), 'utf8')
    // Single-quoted so a resources path with shell metacharacters can't break out.
    expect(content).toContain(`exec '${join(resourcesPath, 'bin', 'manta-ide')}' "$@"`)
    const mode = statSync(join(shimDir!, 'manta')).mode & 0o777
    expect(mode & 0o111).not.toBe(0)
  })

  it('reuses the shim path and re-asserts its exec bit', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    const options = { userDataPath, resourcesPath, appImagePath: null }

    const first = ensureLinuxTerminalMantaCliShimDir(options)
    expect(first).not.toBeNull()
    const shimPath = join(first!, 'manta')
    chmodSync(shimPath, 0o644)

    const second = ensureLinuxTerminalMantaCliShimDir(options)
    expect(second).toBe(first)
    expect(statSync(shimPath).mode & 0o111).not.toBe(0)

    const root = await mkdtemp(join(tmpdir(), 'manta-terminal-cli-shim-2-'))
    created.push(root)
    const otherUserData = join(root, 'user-data')
    mkdirSync(join(otherUserData, 'linux-manta-cli-shim'), { recursive: true })
    writeFileSync(join(otherUserData, 'linux-manta-cli-shim', 'manta'), 'stale contents', 'utf8')
    chmodSync(join(otherUserData, 'linux-manta-cli-shim', 'manta'), 0o644)

    const healed = ensureLinuxTerminalMantaCliShimDir({
      userDataPath: otherUserData,
      resourcesPath,
      appImagePath: null
    })
    expect(healed).not.toBeNull()
    const healedPath = join(healed!, 'manta')
    expect(readFileSync(healedPath, 'utf8')).toContain('manta-ide')
    expect(statSync(healedPath).mode & 0o111).not.toBe(0)
  })

  it.skipIf(!canFenceAppImageRuntime)(
    'routes first-use AppImage terminals through a fenced current mount without a live endpoint',
    async () => {
      const { userDataPath, resourcesPath } = await makeFixture()
      const appImagePath = join(userDataPath, 'Manta.AppImage')
      await mkdir(userDataPath, { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
      const cacheRootPath = join(userDataPath, 'cache')
      const liveLauncherPath = join(resourcesPath, 'bin', 'manta-ide')
      writeFileSync(liveLauncherPath, '#!/usr/bin/env bash\nprintf live', 'utf8')
      chmodSync(liveLauncherPath, 0o755)
      const shimDir = ensureLinuxTerminalMantaCliShimDir({
        userDataPath,
        resourcesPath,
        appImagePath,
        appImageCacheRootPath: cacheRootPath
      })

      const shimPath = join(shimDir!, 'manta')
      const content = readFileSync(shimPath, 'utf8')
      expect(content).toContain(liveLauncherPath)
      expect(content).toContain('runtime_pid=')
      expect(content).toContain('/proc/$runtime_pid/stat')
      expect(existsSync(resolveAppImageLauncherEndpointPath(cacheRootPath, 'live'))).toBe(false)
      await expect(
        runProcess({ program: shimPath, args: [], timeoutMs: 3_000 })
      ).resolves.toMatchObject({ code: 0, stdout: 'live' })
    }
  )

  it.skipIf(!canFenceAppImageRuntime)(
    'refreshes restored terminals to the current AppImage mount',
    async () => {
      const { userDataPath, resourcesPath } = await makeFixture()
      const appImagePath = join(userDataPath, 'Manta.AppImage')
      await mkdir(userDataPath, { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
      const cacheRootPath = join(userDataPath, 'cache')
      const firstLauncher = join(resourcesPath, 'bin', 'manta-ide')
      writeFileSync(firstLauncher, '#!/usr/bin/env bash\nprintf first', 'utf8')
      chmodSync(firstLauncher, 0o755)
      const options = {
        userDataPath,
        resourcesPath,
        appImagePath,
        appImageCacheRootPath: cacheRootPath
      }
      const shimDir = ensureLinuxTerminalMantaCliShimDir(options)
      const shimPath = join(shimDir!, 'manta')
      const originalShim = readFileSync(shimPath, 'utf8')

      const nextResourcesPath = join(userDataPath, 'next-mount', 'resources')
      const nextLauncher = join(nextResourcesPath, 'bin', 'manta-ide')
      await mkdir(join(nextResourcesPath, 'bin'), { recursive: true })
      await writeFile(nextLauncher, '#!/usr/bin/env bash\nprintf next', { mode: 0o755 })
      await rm(firstLauncher)
      expect(
        ensureLinuxTerminalMantaCliShimDir({ ...options, resourcesPath: nextResourcesPath })
      ).toBe(shimDir)

      const refreshedShim = readFileSync(shimPath, 'utf8')
      expect(refreshedShim).not.toBe(originalShim)
      expect(refreshedShim).toContain(nextLauncher)
      expect(existsSync(resolveAppImageLauncherEndpointPath(cacheRootPath, 'live'))).toBe(false)
      await expect(
        runProcess({ program: shimPath, args: [], timeoutMs: 3_000 })
      ).resolves.toMatchObject({ code: 0, stdout: 'next' })
    }
  )

  it.skipIf(!canFenceAppImageRuntime)(
    'rejects a stale shim when its mount path is removed and reused',
    async () => {
      const { userDataPath, resourcesPath } = await makeFixture()
      const appImagePath = join(userDataPath, 'Manta.AppImage')
      const cacheRootPath = join(userDataPath, 'cache')
      await mkdir(userDataPath, { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { mode: 0o755 })
      const liveLauncher = join(resourcesPath, 'bin', 'manta-ide')
      writeFileSync(liveLauncher, '#!/usr/bin/env bash\nprintf original', { mode: 0o755 })
      const shimDir = ensureLinuxTerminalMantaCliShimDir({
        userDataPath,
        resourcesPath,
        appImagePath,
        appImageCacheRootPath: cacheRootPath
      })
      const shimPath = join(shimDir!, 'manta')
      await rm(liveLauncher)
      await writeFile(liveLauncher, '#!/usr/bin/env bash\nprintf replaced-by-another-mount', {
        mode: 0o755
      })

      await expect(
        runProcess({ program: shimPath, args: [], timeoutMs: 3_000 })
      ).resolves.toMatchObject({ code: 1, stdout: '' })
    }
  )

  it.skipIf(!canFenceAppImageRuntime)(
    'rejects a shim after its owning AppImage process generation changes',
    async () => {
      const { userDataPath, resourcesPath } = await makeFixture()
      const appImagePath = join(userDataPath, 'Manta.AppImage')
      await mkdir(userDataPath, { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { mode: 0o755 })
      const liveLauncher = join(resourcesPath, 'bin', 'manta-ide')
      writeFileSync(liveLauncher, '#!/usr/bin/env bash\nprintf original', { mode: 0o755 })
      const shimDir = ensureLinuxTerminalMantaCliShimDir({
        userDataPath,
        resourcesPath,
        appImagePath,
        appImageCacheRootPath: join(userDataPath, 'cache')
      })
      const shimPath = join(shimDir!, 'manta')
      const staleContent = readFileSync(shimPath, 'utf8').replace(
        /runtime_start_time='[^']*'/,
        "runtime_start_time='stale-process'"
      )
      writeFileSync(shimPath, staleContent, { mode: 0o755 })

      await expect(
        runProcess({ program: shimPath, args: [], timeoutMs: 3_000 })
      ).resolves.toMatchObject({ code: 1, stdout: '' })
    }
  )

  it('returns null (and does not memoize) when the bundled launcher is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manta-terminal-cli-shim-missing-'))
    created.push(root)
    const userDataPath = join(root, 'user-data')

    const missing = ensureLinuxTerminalMantaCliShimDir({
      userDataPath,
      resourcesPath: join(root, 'resources'),
      appImagePath: null
    })
    expect(missing).toBeNull()

    // Once the launcher exists (e.g. later probe with real resources), the same
    // userData path succeeds — proving failures are not cached.
    const resourcesPath = join(root, 'resources')
    mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'bin', 'manta-ide'), '#!/usr/bin/env bash\n', 'utf8')
    const recovered = ensureLinuxTerminalMantaCliShimDir({
      userDataPath,
      resourcesPath,
      appImagePath: null
    })
    expect(recovered).toBe(join(userDataPath, 'linux-manta-cli-shim'))
  })
})
