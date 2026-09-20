import { describe, expect, it } from 'vitest'
import { XTERM_ENGINE_JS } from '../terminal-webview-engine.generated'
import { XTERM_HTML } from '../terminal-webview-html'
import {
  compareTerminalDocumentScripts,
  readTerminalDocumentScript,
  type TerminalDocumentNormalisations
} from './terminal-document-equivalence.test-support'

/**
 * The instrument the C7.1 flip commit is reviewed with, exercised on what it will be asked.
 *
 * Each refusal below is one way the move could go wrong, and they matter more than the
 * acceptances: a comparison that let a reordered statement or a changed literal through would pass
 * the flip while the document had quietly become a different program.
 */
const QUALIFIER = 'scope'
const script = readTerminalDocumentScript(XTERM_HTML, XTERM_ENGINE_JS)

const NONE: TerminalDocumentNormalisations = {
  qualifiedReferences: 0,
  scopeFieldDeclarations: 0,
  rebindings: 0,
  bracedBodies: 0,
  unboundCatches: 0,
  numberProperties: 0,
  shorthandProperties: 0,
  unshadowedNames: 0
}

function normalisationsOf(before: string, after: string): TerminalDocumentNormalisations | string {
  const result = compareTerminalDocumentScripts(before, after, QUALIFIER)
  return result.equivalent ? result.normalisations : result.reason
}

describe('terminal document script equivalence', () => {
  it('reads the hand-written script out of the real document', () => {
    expect(script.trimStart().startsWith('(function() {')).toBe(true)
    expect(script.trimEnd().endsWith('})();')).toBe(true)
  })

  it('accepts the real script against itself, normalising nothing', () => {
    // The instrument on the real 2,758-line program rather than on a toy, which is the only way to
    // know it survives everything the document actually contains.
    expect(normalisationsOf(script, script)).toEqual(NONE)
  })

  it('ignores the semicolons the formatter drops and the comments it keeps', () => {
    const before = '// one\nvar a = 1;\nfunction f() {\n  b(a);\n}\n'
    const after = '/* other */\nvar a = 1\nfunction f() {\n  b(a)\n}\n'
    expect(normalisationsOf(before, after)).toEqual(NONE)
  })

  it('counts a reference that gained the qualifier', () => {
    expect(
      normalisationsOf(
        'function f() { return a + a; }',
        'function f() { return scope.a + scope.a }'
      )
    ).toEqual({ ...NONE, qualifiedReferences: 2 })
  })

  it('counts a declaration that moved onto the scope object', () => {
    // `var a = 1` and `a = 1` are different sites: one dropped a `var`, the other never had one.
    expect(normalisationsOf('var a = 1;\na = 2;', 'scope.a = 1\nscope.a = 2')).toEqual({
      ...NONE,
      scopeFieldDeclarations: 1,
      qualifiedReferences: 1
    })
  })

  it('counts a var that stayed local and only changed keyword', () => {
    expect(normalisationsOf('var a = 1;', 'const a = 1')).toEqual({ ...NONE, rebindings: 1 })
  })

  it('counts a var that became a let, which acorn reports as a name', () => {
    // `let` is contextual outside strict mode, so a rule matching on the token label alone would
    // refuse every reassigned local the linter rewrote.
    expect(normalisationsOf('var a = 1;\na = 2;', 'let a = 1\na = 2')).toEqual({
      ...NONE,
      rebindings: 1
    })
  })

  it('counts braces the linter adds to a brace-less body', () => {
    const before = 'if (a) b();\nfor (;;) c();\n'
    const after = 'if (a) {\n  b()\n}\nfor (;;) {\n  c()\n}\n'
    expect(normalisationsOf(before, after)).toEqual({ ...NONE, bracedBodies: 2 })
  })

  it('counts a catch clause the linter unbound', () => {
    expect(normalisationsOf('try { a(); } catch (e) {}', 'try {\n  a()\n} catch {}')).toEqual({
      ...NONE,
      unboundCatches: 1,
      numberProperties: 0,
      shorthandProperties: 0,
      unshadowedNames: 0
    })
  })

  it('counts a global numeric function the linter moved onto Number', () => {
    expect(
      normalisationsOf('if (isFinite(a)) b();', 'if (Number.isFinite(a)) {\n  b()\n}')
    ).toEqual({
      ...NONE,
      numberProperties: 1,
      bracedBodies: 1
    })
  })

  it('refuses a global the linter does not move, qualified as if it did', () => {
    // Only the four numeric globals are this rewrite; anything else under `Number` is a change.
    expect(normalisationsOf('a = setTimeout(f);', 'a = Number.setTimeout(f)')).toContain('token 2')
  })

  it('refuses a qualifier under a name it was not told to expect', () => {
    expect(normalisationsOf('a = 1;', 'state.a = 1')).toContain('token 0')
  })

  it('counts a shorthand property the qualifier had to spell out', () => {
    expect(
      normalisationsOf('var o = { alt: alt, n: 1 };', 'var o = { alt: scope.alt, n: 1 };')
    ).toEqual({ ...NONE, shorthandProperties: 1 })
  })

  it('counts each declarator of one var that moved onto the scope', () => {
    expect(normalisationsOf('var a = 1, b = 2;', 'scope.a = 1; scope.b = 2;')).toEqual({
      ...NONE,
      scopeFieldDeclarations: 2
    })
  })

  it('reads a block-scoped function declaration the same way on both sides', () => {
    const script = 'function f() { if (a) { function g() { return 1; } return g(); } }'
    expect(normalisationsOf(script, script)).toEqual(NONE)
  })

  it('counts a name the printer no longer has to disambiguate', () => {
    expect(
      normalisationsOf(
        'var term = null; function f(term) { return term; }',
        'scope.term = null; function f(term) { return term; }'
      )
    ).toEqual({ ...NONE, scopeFieldDeclarations: 1, unshadowedNames: 2 })
  })

  it('refuses a numeric-suffix rename that is not a listed unshadowed binding', () => {
    // The shape `value2` -> `value` is what the printer does to a shadow, but this pair is not one
    // of the document's, so it is a renamed local: a changed program, not a normalisation.
    expect(
      normalisationsOf('function f() { return value2; }', 'function f() { return value; }')
    ).toBe('token 6: expected name value2, generated name value')
  })

  it('refuses a bare block the baseline does not have', () => {
    // A block that is nobody's body cannot be the `curly` rule's work, so absorbing it would hide
    // a statement boundary the baseline never had.
    expect(normalisationsOf('let value = 1; use(value);', '{ let value = 1; } use(value);')).toBe(
      'token 0: expected name let, generated {'
    )
  })

  it('counts a braced body only for a head that can carry an unbraced one', () => {
    expect(normalisationsOf('if (a) b();', 'if (a) { b(); }')).toEqual({
      ...NONE,
      bracedBodies: 1
    })
    expect(normalisationsOf('for (;;) b();', 'for (;;) { b(); }')).toEqual({
      ...NONE,
      bracedBodies: 1
    })
    expect(normalisationsOf('while (a) b();', 'while (a) { b(); }')).toEqual({
      ...NONE,
      bracedBodies: 1
    })
    expect(normalisationsOf('if (a) b(); else c();', 'if (a) { b(); } else { c(); }')).toEqual({
      ...NONE,
      bracedBodies: 2
    })
    expect(normalisationsOf('do b(); while (a);', 'do { b(); } while (a);')).toEqual({
      ...NONE,
      bracedBodies: 1
    })
  })

  it('refuses a changed literal', () => {
    expect(normalisationsOf('var a = 1;', 'var a = 2')).toBe(
      'token 3: expected num 1, generated num 2'
    )
  })

  it('refuses a dropped operator', () => {
    expect(normalisationsOf('if (!a) return;', 'if (a) return')).toBe(
      'token 2: expected !/~ !, generated name a'
    )
  })

  it('refuses a reordered pair of statements', () => {
    expect(normalisationsOf('a();\nb();', 'b()\na()')).toContain('token 0')
  })

  it('refuses a dropped statement', () => {
    expect(normalisationsOf('a();\nb();', 'a()')).toBe(
      'length: 3 token(s) left in the baseline, 0 in the generated script'
    )
  })

  it('refuses a renamed local', () => {
    expect(normalisationsOf('function f(x) { return x; }', 'function f(y) { return y }')).toBe(
      'token 3: expected name x, generated name y'
    )
  })

  it('refuses a generated script the printer cannot parse', () => {
    // Both sides go through the printer, so something broken is reported here with its own
    // message rather than thrown out of the comparison.
    expect(normalisationsOf('if (a) b();', 'if (a) {\n  b()')).toContain(
      'the generated script does not parse'
    )
  })

  it('refuses a baseline the printer cannot parse, naming that side', () => {
    expect(normalisationsOf('a()\n}', 'a()')).toContain('the baseline does not parse')
  })
})
