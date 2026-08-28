import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getMantaElectronLaunchArgs } from './electron-launch-args'

describe('getMantaElectronLaunchArgs', () => {
  it('launches the package root that owns the compiled main entry', () => {
    const root = join('workspace', 'manta')
    const mainPath = join(root, 'out', 'main', 'index.js')

    const args = getMantaElectronLaunchArgs(mainPath, true)
    expect(args.at(-1)).toBe(root)
    if (process.platform === 'darwin') {
      expect(args.slice(0, -1)).toEqual(['--password-store=basic', '--use-mock-keychain'])
    }
    expect(getMantaElectronLaunchArgs(mainPath, false).at(-1)).toBe(root)
  })
})
