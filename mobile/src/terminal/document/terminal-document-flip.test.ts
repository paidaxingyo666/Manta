import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  buildTerminalDocumentScript,
  emitTerminalDocumentModule
} from '../../../scripts/build-terminal-document-script.mjs'
import { TERMINAL_DOCUMENT_MODULE_ORDER } from '../../../scripts/terminal-document-module-order.mjs'
import { compareTerminalDocumentScripts } from './terminal-document-equivalence.test-support'

/**
 * The review of the move, as one number per difference class.
 *
 * `terminal-document-pre-flip-script.txt` is the hand-written script exactly as it stood before any
 * of this, taken from the byte fixture that pinned it. This says the modules emit the same program
 * modulo the qualifier and the repository's own rules rewriting an ES5 document the moment its
 * source is a linted module. Anything outside those classes refuses with the token index and both
 * sides, so a reordered statement, a changed literal or a renamed local cannot pass here.
 *
 * The scope object is the one thing the emitted script has that the document did not, so it is
 * pinned on its own below rather than folded into a count.
 *
 * Retirement, per ruling 18: this test is the proof of the flip and holds only while no module
 * changes, so the first lane that must change one retires it together with
 * `terminal-document-pre-flip-script.txt`, and the standing pin from then on is
 * `terminal-document-identity.test.ts`, whose fixture regeneration is a review event.
 */
const preFlipScript = readFileSync(
  new URL('../terminal-document-pre-flip-script.txt', import.meta.url),
  'utf8'
)

describe('the whole terminal document script', () => {
  it('is what the modules emit, modulo the eight counted classes', async () => {
    const emitted = await Promise.all(
      TERMINAL_DOCUMENT_MODULE_ORDER.map((name) =>
        emitTerminalDocumentModule(fileURLToPath(new URL(`./${name}.ts`, import.meta.url)))
      )
    )
    const candidate = `(function() {\n${emitted.join('\n')}\n})();`
    expect(compareTerminalDocumentScripts(preFlipScript, candidate, 'scope')).toEqual({
      equivalent: true,
      normalisations: {
        // The qualifier, partitioned: 609 reads and writes of a name whose declaration stayed put,
        // and 73 declarations that moved onto the scope object. 682 sites in all.
        qualifiedReferences: 609,
        scopeFieldDeclarations: 73,
        // The document's 446 `var` declarators, less the 73 that became scope fields.
        rebindings: 373,
        // `curly`, measured over the whole script before any of this started.
        bracedBodies: 279,
        // Of the document's 38 catch clauses, two name their error and report it, so they keep it.
        unboundCatches: 36,
        // `unicorn/prefer-number-properties`, also measured up front.
        numberProperties: 17,
        // Two SGR mode flags written twice each: shorthand cannot survive a qualified value.
        shorthandProperties: 4,
        // Names the printer had to disambiguate while an outer binding of the same name existed.
        unshadowedNames: 7
      }
    })
  })

  it('adds the scope object and nothing else', async () => {
    const script = await buildTerminalDocumentScript()
    const emitted = await Promise.all(
      TERMINAL_DOCUMENT_MODULE_ORDER.map((name) =>
        emitTerminalDocumentModule(fileURLToPath(new URL(`./${name}.ts`, import.meta.url)))
      )
    )
    const body = emitted.join('\n')
    const at = script.indexOf(body)
    expect(at).toBeGreaterThan(-1)
    const preamble = script.slice('(function() {\n'.length, at)
    expect(script.slice(at + body.length)).toBe('\n})();')
    expect(preamble).toContain('function createTerminalDocumentScope()')
    expect(preamble).toContain('const scope = createTerminalDocumentScope();')
    expect(preamble.split('createTerminalDocumentScope').length - 1).toBe(2)
  })
})
