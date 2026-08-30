import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readlink, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmpdir(), getAppPath: () => tmpdir() }
}))

import { resolveAppImageExtractedRoot } from './appimage-extracted-root'
import {
  publishAppImageLauncherEndpoint,
  resolveAppImageLauncherEndpointPath,
  resolveAppImageStableLauncherPath
} from './appimage-stable-launcher'
import { CliInstaller } from './cli-installer'
import type { CliInstallerOptions } from './cli-installer-contracts'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('AppImage CLI removal', () => {
  it.each([false, true])(
    'removes installed payloads while preserving the live PTY launcher (command missing: %s)',
    async (removeCommandFirst) => {
      const root = await mkdtemp(join(tmpdir(), 'orca-appimage-cli-remove-'))
      created.push(root)
      const appImagePath = join(root, 'Manta.AppImage')
      const cacheRootPath = join(root, 'cache')
      const commandPath = join(root, 'home', '.local', 'bin', 'manta-ide')
      const resourcesPath = join(root, 'mount', 'resources')
      const liveLauncherPath = join(resourcesPath, 'bin', 'manta-ide')
      await mkdir(join(resourcesPath, 'bin'), { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { mode: 0o755 })
      await writeFile(liveLauncherPath, '#!/usr/bin/env bash\nprintf live', { mode: 0o755 })
      publishAppImageLauncherEndpoint(cacheRootPath, 'live', liveLauncherPath)

      const installer = new CliInstaller({
        platform: 'linux',
        isPackaged: true,
        userDataPath: join(root, 'user-data'),
        resourcesPath,
        execPath: join(root, 'mount', 'manta-ide'),
        appPath: join(resourcesPath, 'app.asar'),
        homePath: join(root, 'home'),
        processPathEnv: join(root, 'home', '.local', 'bin'),
        commandPathOverride: commandPath,
        appImagePath,
        appImageCacheRootPath: cacheRootPath,
        appImageExtractRunner: async (_path, cwd) => {
          const payloadDirectory = join(cwd, 'squashfs-root', 'resources', 'bin')
          await mkdir(payloadDirectory, { recursive: true })
          await writeFile(
            join(payloadDirectory, 'manta-ide'),
            '#!/usr/bin/env bash\nprintf installed',
            {
              mode: 0o755
            }
          )
        }
      })

      const installed = await installer.install()
      const extractedRoot = resolveAppImageExtractedRoot({ appImagePath, cacheRootPath })!
      expect(await readlink(commandPath)).toBe(installed.launcherPath)
      expect(existsSync(extractedRoot.rootPath)).toBe(true)
      if (removeCommandFirst) {
        await unlink(commandPath)
      }

      await expect(installer.remove()).resolves.toMatchObject({ state: 'not_installed' })

      expect(existsSync(commandPath)).toBe(false)
      expect(existsSync(extractedRoot.rootPath)).toBe(false)
      expect(existsSync(resolveAppImageLauncherEndpointPath(cacheRootPath, 'installed'))).toBe(
        false
      )
      expect(existsSync(resolveAppImageLauncherEndpointPath(cacheRootPath, 'live'))).toBe(true)
      const stableLauncherPath = resolveAppImageStableLauncherPath(cacheRootPath)
      expect(existsSync(stableLauncherPath)).toBe(true)
      await expect(
        runProcess({ program: stableLauncherPath, args: [], timeoutMs: 3_000 })
      ).resolves.toMatchObject({ code: 0, stdout: 'live' })
    }
  )

  it('does not remove a sibling AppImage registration or payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-appimage-cli-siblings-'))
    created.push(root)
    const cacheRootPath = join(root, 'cache')
    const commandPath = join(root, 'home', '.local', 'bin', 'manta-ide')
    const resourcesPath = join(root, 'mount', 'resources')
    const firstAppImagePath = join(root, 'Orca-stable.AppImage')
    const secondAppImagePath = join(root, 'Orca-nightly.AppImage')
    await mkdir(join(resourcesPath, 'bin'), { recursive: true })
    await Promise.all([
      writeFile(firstAppImagePath, '#!/usr/bin/env bash\n', { mode: 0o755 }),
      writeFile(secondAppImagePath, '#!/usr/bin/env bash\n# nightly\n', { mode: 0o755 })
    ])
    const installerOptions = (appImagePath: string, content: string): CliInstallerOptions => ({
      platform: 'linux',
      isPackaged: true,
      userDataPath: join(root, 'user-data'),
      resourcesPath,
      execPath: join(root, 'mount', 'manta-ide'),
      appPath: join(resourcesPath, 'app.asar'),
      homePath: join(root, 'home'),
      processPathEnv: join(root, 'home', '.local', 'bin'),
      commandPathOverride: commandPath,
      appImagePath,
      appImageCacheRootPath: cacheRootPath,
      appImageExtractRunner: async (_path, cwd) => {
        const payloadDirectory = join(cwd, 'squashfs-root', 'resources', 'bin')
        await mkdir(payloadDirectory, { recursive: true })
        await writeFile(join(payloadDirectory, 'manta-ide'), content, { mode: 0o755 })
      }
    })
    class HookedInstaller extends CliInstaller {
      afterNextStatus: (() => Promise<void>) | null = null

      override async getStatus() {
        const status = await super.getStatus()
        const hook = this.afterNextStatus
        this.afterNextStatus = null
        await hook?.()
        return status
      }
    }
    let siblingStatusReads = 0
    class TrackingInstaller extends CliInstaller {
      override async getStatus() {
        siblingStatusReads += 1
        return super.getStatus()
      }
    }
    const firstInstaller = new HookedInstaller(installerOptions(firstAppImagePath, 'stable'))
    const secondInstaller = new TrackingInstaller(installerOptions(secondAppImagePath, 'nightly'))

    await firstInstaller.install()
    const firstRoot = resolveAppImageExtractedRoot({
      appImagePath: firstAppImagePath,
      cacheRootPath
    })!
    await secondInstaller.install()
    const secondRoot = resolveAppImageExtractedRoot({
      appImagePath: secondAppImagePath,
      cacheRootPath
    })!

    const siblingStatus = await firstInstaller.getStatus()
    expect(firstInstaller.isAppImageRegistrationOwnedBySibling(siblingStatus)).toBe(true)
    await rm(resolveAppImageStableLauncherPath(cacheRootPath))
    const brokenLauncherStatus = await firstInstaller.getStatus()
    expect(firstInstaller.isAppImageRegistrationOwnedBySibling(brokenLauncherStatus)).toBe(false)
    publishAppImageLauncherEndpoint(cacheRootPath, 'installed', secondRoot.payloadLauncherPath)

    await firstInstaller.remove()

    expect(existsSync(firstRoot.rootPath)).toBe(false)
    expect(existsSync(secondRoot.rootPath)).toBe(true)
    expect(existsSync(commandPath)).toBe(true)
    await expect(
      readlink(resolveAppImageLauncherEndpointPath(cacheRootPath, 'installed'))
    ).resolves.toBe(secondRoot.payloadLauncherPath)

    await firstInstaller.install()
    let siblingInstall: Promise<unknown> | null = null
    siblingStatusReads = 0
    firstInstaller.afterNextStatus = async () => {
      siblingInstall = secondInstaller.install()
      await Promise.resolve()
      expect(siblingStatusReads).toBe(0)
    }
    await firstInstaller.remove()
    expect(siblingInstall).not.toBeNull()
    await siblingInstall

    expect(siblingStatusReads).toBeGreaterThan(0)
    expect(existsSync(commandPath)).toBe(true)
    expect(existsSync(secondRoot.rootPath)).toBe(true)
    await expect(
      readlink(resolveAppImageLauncherEndpointPath(cacheRootPath, 'installed'))
    ).resolves.toBe(secondRoot.payloadLauncherPath)
  })
})
