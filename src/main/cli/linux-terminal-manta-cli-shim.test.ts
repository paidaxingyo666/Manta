import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true }
}))

import { ensureLinuxTerminalMantaCliShimDir } from './linux-terminal-manta-cli-shim'

const created: string[] = []

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
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ensureLinuxTerminalMantaCliShimDir', () => {
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

  it('memoizes per userDataPath and re-asserts the exec bit for a stale shim', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    const options = { userDataPath, resourcesPath, appImagePath: null }

    const first = ensureLinuxTerminalMantaCliShimDir(options)
    expect(first).not.toBeNull()
    const shimPath = join(first!, 'manta')
    chmodSync(shimPath, 0o644)

    // A distinct userData path is not memoized, so ensure runs again and heals
    // the exec bit lost above only when it actually processes that path.
    const second = ensureLinuxTerminalMantaCliShimDir(options)
    expect(second).toBe(first)

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

  it('execs the stable AppImage (not the ephemeral mount) when running from an AppImage', async () => {
    const { userDataPath, resourcesPath } = await makeFixture()
    const appImagePath = join(userDataPath, 'Applications', 'Manta.AppImage')

    const shimDir = ensureLinuxTerminalMantaCliShimDir({
      userDataPath,
      resourcesPath,
      appImagePath
    })

    const content = readFileSync(join(shimDir!, 'manta'), 'utf8')
    expect(content).toContain(appImagePath)
    expect(content).not.toContain(resourcesPath)
  })

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
