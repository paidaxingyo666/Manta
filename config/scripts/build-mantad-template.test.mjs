import { describe, expect, it } from 'vitest'
import { ORCAD_TEMPLATE_TARGETS } from '../../src/shared/node-runtime-pin.ts'
import { requestedTemplateTargets } from './build-mantad-template.mjs'

describe('requestedTemplateTargets', () => {
  it('builds every target unless a subset is named', () => {
    expect(requestedTemplateTargets(['node', 'build-mantad-template.mjs'])).toEqual(
      ORCAD_TEMPLATE_TARGETS
    )
  })

  it('accepts a named subset once each', () => {
    expect(
      requestedTemplateTargets([
        'node',
        'build-mantad-template.mjs',
        '--targets',
        'linux-x64-glibc,linux-x64-musl,linux-x64-glibc'
      ])
    ).toEqual(['linux-x64-glibc', 'linux-x64-musl'])
  })

  it.each([[['--targets']], [['--targets', '']], [['--targets', 'linux-x64-glibc,sunos-sparc']]])(
    'refuses %j',
    (args) => {
      expect(() => requestedTemplateTargets(['node', 'build-mantad-template.mjs', ...args])).toThrow(
        '--targets needs a comma-separated subset'
      )
    }
  )
})
