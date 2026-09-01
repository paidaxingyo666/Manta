import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MAX_RUNTIME_MODULE_LINES = 400

function runtimeImplementationModuleNames(): string[] {
  return readdirSync(import.meta.dirname)
    .filter(
      (name) =>
        name.endsWith('.ts') &&
        !name.includes('.test.') &&
        !name.includes('.spec.') &&
        (name === 'manta-runtime.ts' ||
          name.startsWith('manta-runtime-') ||
          name.startsWith('runtime-browser-commands-') ||
          name.startsWith('runtime-file-commands-'))
    )
    .sort()
}

describe('Manta runtime module size', () => {
  it('keeps every split implementation module at or below 400 physical lines', () => {
    const oversized = runtimeImplementationModuleNames().flatMap((name) => {
      const lines = readFileSync(join(import.meta.dirname, name), 'utf8').split(/\r?\n/).length
      return lines > MAX_RUNTIME_MODULE_LINES ? [`${name}: ${lines}`] : []
    })

    expect(oversized).toEqual([])
  })
})
