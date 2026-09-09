import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMantaElectronLaunchArgs } from './electron-launch-args'

describe('getMantaElectronLaunchArgs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['linux', 'true', true, true],
    ['linux', undefined, true, false],
    ['linux', 'true', false, false],
    ['darwin', 'true', true, false],
    ['win32', 'true', true, false]
  ] as const)(
    'scopes software WebGL to Linux CI headful launches: %s/%s/%s',
    (platform, ci, headful, enabled) => {
      vi.stubGlobal('process', { ...process, platform, env: { ...process.env, CI: ci } })
      const args = getMantaElectronLaunchArgs(join('manta', 'out', 'main', 'index.js'), headful)
      expect(args.includes('--use-gl=angle')).toBe(enabled)
      expect(args.includes('--use-angle=swiftshader')).toBe(enabled)
      expect(args.includes('--enable-unsafe-swiftshader')).toBe(enabled)
      if (enabled) {
        expect(args).toContain('--disable-gpu-sandbox')
        expect(args).not.toContain('--disable-gpu')
      }
    }
  )

  it('launches the package root that owns the compiled main entry', () => {
    const root = join('workspace', 'manta')
    const mainPath = join(root, 'out', 'main', 'index.js')

    const args = getMantaElectronLaunchArgs(mainPath, true)
    if (process.platform === 'darwin') {
      expect(args).toEqual([
        '--password-store=basic',
        '--use-mock-keychain',
        root,
        '-ApplePersistenceIgnoreState',
        'YES'
      ])
    } else {
      expect(args.at(-1)).toBe(root)
    }
    expect(getMantaElectronLaunchArgs(mainPath, false)).toContain(root)
  })
})
