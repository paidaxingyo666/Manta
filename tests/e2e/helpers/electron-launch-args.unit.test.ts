import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getMantaElectronLaunchArgs } from './electron-launch-args'

describe('getMantaElectronLaunchArgs', () => {
  it('launches the package root that owns the compiled main entry', () => {
    const root = join('workspace', 'manta')
    const mainPath = join(root, 'out', 'main', 'index.js')

    expect(getMantaElectronLaunchArgs(mainPath, true)).toEqual([root])
    expect(getMantaElectronLaunchArgs(mainPath, false).at(-1)).toBe(root)
  })
})
