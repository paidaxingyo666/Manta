import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: the fragments are `.spec.ts`, which no Vitest `include` glob matches — they only run
// because manta-runtime.test.ts imports them. A fragment left out of that list never runs and
// nothing fails, so the import list is the coverage boundary and has to be checked.
const ENTRYPOINT = 'manta-runtime.test.ts'
const FRAGMENT_DIR = 'manta-runtime-tests'

function importedFragments(): string[] {
  const source = readFileSync(join(import.meta.dirname, ENTRYPOINT), 'utf8')
  return [...source.matchAll(/await import\('\.\/manta-runtime-tests\/([\w-]+)\.spec'\)/g)]
    .map((match) => `${match[1]}.spec.ts`)
    .sort()
}

function fragmentsOnDisk(): string[] {
  return readdirSync(join(import.meta.dirname, FRAGMENT_DIR))
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
}

describe('Manta runtime test fragments', () => {
  it('imports every fragment exactly once from the compatibility entrypoint', () => {
    const imported = importedFragments()
    expect(imported).toEqual(fragmentsOnDisk())
    expect(imported).toEqual([...new Set(imported)])
  })
})
