import { describe, expect, it } from 'vitest'
import {
  expandWindowsEnvironmentVariables,
  expandWindowsPathEnvironmentVariables
} from './windows-environment-expansion'

describe('expandWindowsEnvironmentVariables', () => {
  it('expands names case-insensitively and preserves unknown variables', () => {
    expect(
      expandWindowsEnvironmentVariables('%localappdata%\\agy\\bin;%MISSING%\\bin', {
        LOCALAPPDATA: 'C:\\Users\\manta\\AppData\\Local'
      })
    ).toBe('C:\\Users\\manta\\AppData\\Local\\agy\\bin;%MISSING%\\bin')
  })

  it('expands variables with empty values', () => {
    expect(expandWindowsEnvironmentVariables('before%EMPTY%after', { EMPTY: '' })).toBe(
      'beforeafter'
    )
  })
})

describe('expandWindowsPathEnvironmentVariables', () => {
  it('expands every Windows PATH casing without changing other variables', () => {
    const env = {
      MANTA_PATH_ROOT: 'C:\\Users\\manta',
      Path: '%MANTA_PATH_ROOT%\\bin',
      PATH: '%manta_path_root%\\tools',
      TEMPLATE: '%MANTA_PATH_ROOT%\\template'
    }

    expandWindowsPathEnvironmentVariables(env, 'win32')

    expect(env.Path).toBe('C:\\Users\\manta\\bin')
    expect(env.PATH).toBe('C:\\Users\\manta\\tools')
    expect(env.TEMPLATE).toBe('%MANTA_PATH_ROOT%\\template')
  })

  it('leaves non-Windows PATH values unchanged', () => {
    const env = { ROOT: '/opt/manta', PATH: '%ROOT%/bin:/usr/bin' }

    expandWindowsPathEnvironmentVariables(env, 'linux')

    expect(env.PATH).toBe('%ROOT%/bin:/usr/bin')
  })
})
