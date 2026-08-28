import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppPathName } from '../../shared/app-environment'
import { resolveMantadInstallRoot, resolveMantadPath, resolveUserDataPath } from './mantad-app-paths'

const ALL_PATH_NAMES: AppPathName[] = [
  'userData',
  'home',
  'appData',
  'temp',
  'downloads',
  'logs',
  'exe'
]

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
})

describe('resolveUserDataPath', () => {
  it('prefers MANTA_USER_DATA, then XDG_DATA_HOME, then ~/.manta', () => {
    vi.stubEnv('MANTA_USER_DATA', join(sep, 'srv', 'manta-state'))
    vi.stubEnv('XDG_DATA_HOME', join(sep, 'xdg'))
    expect(resolveUserDataPath()).toBe(join(sep, 'srv', 'manta-state'))

    vi.stubEnv('MANTA_USER_DATA', '')
    expect(resolveUserDataPath()).toBe(join(sep, 'xdg', 'Manta'))

    vi.stubEnv('XDG_DATA_HOME', '')
    expect(resolveUserDataPath()).toBe(join(homedir(), '.manta'))
  })
})

describe('resolveMantadPath', () => {
  it('answers every path name without ever falling back to the data directory', () => {
    vi.stubEnv('MANTA_USER_DATA', join(sep, 'srv', 'manta-state'))
    const answers = new Map(ALL_PATH_NAMES.map((name) => [name, resolveMantadPath(name)]))

    for (const [name, answer] of answers) {
      expect(answer, `${name} answered nothing`).toBeTruthy()
      if (name !== 'userData') {
        // The catch-all this replaced returned the data directory for four of seven
        // names, 'exe' included — a data directory is not an executable.
        expect(answer, `${name} answered the userData directory`).not.toBe(
          join(sep, 'srv', 'manta-state')
        )
      }
    }
  })

  it("answers 'exe' with the Node binary running this process", () => {
    expect(resolveMantadPath('exe')).toBe(process.execPath)
  })

  it("keeps 'logs' inside the data root so the whole deployment is one directory", () => {
    vi.stubEnv('MANTA_USER_DATA', join(sep, 'srv', 'manta-state'))
    expect(resolveMantadPath('logs')).toBe(join(sep, 'srv', 'manta-state', 'logs'))
  })

  it("answers 'home' and 'temp' from the OS", () => {
    expect(resolveMantadPath('home')).toBe(homedir())
    expect(resolveMantadPath('temp')).toBe(tmpdir())
  })

  it("answers 'appData' with the per-user application-data root of each platform", () => {
    setPlatform('darwin')
    expect(resolveMantadPath('appData')).toBe(join(homedir(), 'Library', 'Application Support'))

    setPlatform('win32')
    vi.stubEnv('APPDATA', join('C:', 'Users', 'manta', 'AppData', 'Roaming'))
    expect(resolveMantadPath('appData')).toBe(join('C:', 'Users', 'manta', 'AppData', 'Roaming'))
    vi.stubEnv('APPDATA', '')
    expect(resolveMantadPath('appData')).toBe(join(homedir(), 'AppData', 'Roaming'))

    setPlatform('linux')
    vi.stubEnv('XDG_CONFIG_HOME', join(sep, 'xdg-config'))
    expect(resolveMantadPath('appData')).toBe(join(sep, 'xdg-config'))
    vi.stubEnv('XDG_CONFIG_HOME', '')
    expect(resolveMantadPath('appData')).toBe(join(homedir(), '.config'))
  })

  it("answers 'downloads' from XDG_DOWNLOAD_DIR before the home default", () => {
    vi.stubEnv('XDG_DOWNLOAD_DIR', join(sep, 'srv', 'incoming'))
    expect(resolveMantadPath('downloads')).toBe(join(sep, 'srv', 'incoming'))

    vi.stubEnv('XDG_DOWNLOAD_DIR', '')
    expect(resolveMantadPath('downloads')).toBe(join(homedir(), 'Downloads'))
  })
})

describe('resolveMantadInstallRoot', () => {
  it('is the directory holding the running bundle, not the working directory', () => {
    expect(resolveMantadInstallRoot(join(sep, 'opt', 'manta', 'mantad.js'))).toBe(
      join(sep, 'opt', 'manta')
    )
  })

  it('absolutizes a relative script path against the working directory', () => {
    expect(resolveMantadInstallRoot(join('out', 'mantad', 'mantad.js'))).toBe(
      join(process.cwd(), 'out', 'mantad')
    )
  })

  it('refuses instead of guessing when the process has no main script', () => {
    const originalArgv = process.argv
    // `node -e` leaves argv[1] unset; cwd would be a guess, not an answer.
    process.argv = [process.execPath]
    try {
      expect(() => resolveMantadInstallRoot()).toThrow(/mantad_install_root_unavailable/)
    } finally {
      process.argv = originalArgv
    }
  })
})
