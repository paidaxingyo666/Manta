import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TERMINAL_DOCUMENT_MODULE_ORDER,
  TERMINAL_DOCUMENT_SCOPE_MODULE
} from '../../../scripts/terminal-document-module-order.mjs'

/**
 * Every module in this directory is in the document, and everything in the order list is here.
 *
 * The generator emits exactly what the order list names, so a module added here and forgotten
 * there is dead code that reads as live, and a name left in the list after its file goes makes the
 * generator throw at build time rather than at review time. Both directions are asserted.
 *
 * `document-constants` is the one file that is deliberately not emitted: its exports are
 * substituted into the modules that import them as literals, so the document carries its values
 * without carrying the module.
 */
const NOT_EMITTED = 'document-constants'

function documentModuleNames(): string[] {
  return readdirSync(new URL('.', import.meta.url))
    .filter((entry) => entry.endsWith('.ts'))
    .filter((entry) => !entry.endsWith('.test.ts') && !entry.endsWith('.test-support.ts'))
    .map((entry) => entry.slice(0, -'.ts'.length))
    .sort()
}

describe('the document module order', () => {
  it('names every module the directory holds, and only those', () => {
    const expected = [
      NOT_EMITTED,
      TERMINAL_DOCUMENT_SCOPE_MODULE,
      ...TERMINAL_DOCUMENT_MODULE_ORDER
    ].sort()
    expect(documentModuleNames()).toEqual(expected)
  })

  it('names each module once, so the generator cannot emit one twice', () => {
    const listed = [TERMINAL_DOCUMENT_SCOPE_MODULE, ...TERMINAL_DOCUMENT_MODULE_ORDER]
    expect(listed).toHaveLength(new Set(listed).size)
  })
})
