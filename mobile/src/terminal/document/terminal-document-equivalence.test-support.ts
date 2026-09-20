import {
  describeToken,
  readScriptTokens,
  type DocumentToken
} from './terminal-document-tokens.test-support'

/**
 * Whether two versions of the in-WebView document script are the same program, allowing only the
 * scope qualifier that moving it into modules requires.
 *
 * C7.1 turns the document's one 2,758-line IIFE into modules the web page can import. A variable
 * the script assigns across what became a module boundary cannot stay a free variable — assigning
 * an imported binding is a syntax error — so those become fields of one scope object, 73
 * declaration sites in all, and every read and write of them gains a qualifier. Nothing else about
 * the program may change.
 *
 * Byte comparison cannot make that claim once the source is formatter-owned: `oxfmt` writes the
 * repository's style, which drops the semicolons the hand-written document carries, so the emitted
 * text necessarily differs on almost every line for reasons that are not the refactor. Tokens are
 * the level where the claim is exactly true. Semicolons are excluded for the same reason they moved
 * — they are the formatter's, not the program's — and comments never reach the stream.
 *
 * This is deliberately stricter than "it still runs": a reordered statement, a changed literal, a
 * dropped `!`, a renamed local, all diverge here and are reported with the token index and both
 * sides, so the flip commit is reviewed by running this rather than by reading a 515-line diff.
 */
/**
 * The differences moving the script into modules is allowed to make, each counted on its own.
 *
 * Eight classes and no others. Six are the repository's own rules and the printer rewriting the
 * document's ES5 style the moment its source is a linted module — measured over the whole script,
 * not assumed: `curly` braces 279 brace-less bodies, `no-unused-vars` unbinds 36 catch clauses, 373
 * `var` declarators become `const` or `let`, `unicorn/prefer-number-properties` moves 17 globals
 * onto `Number`, the printer spells out 4 shorthand properties whose value gained a qualifier, and
 * it stops renaming 7 bindings that are no longer shadows. The other two are the move itself: 609
 * qualified references and 73 declarations onto the scope. Semicolons and whitespace are the
 * formatter's and never reach the token stream at all.
 *
 * Counted separately because the flip commit pins each number: a total would let one class absorb
 * another, which is exactly the drift the pin exists to catch.
 */
export type TerminalDocumentNormalisations = {
  /** `name` became `<qualifier>.name`; the declaration stayed where it was. */
  readonly qualifiedReferences: number
  /**
   * `var name` became `<qualifier>.name`; the declaration moved onto the scope object. A `var`
   * with several declarators counts once per declarator, because each becomes its own assignment.
   */
  readonly scopeFieldDeclarations: number
  /** `var` became `const` or `let`, the binding staying local to the emitted script. */
  readonly rebindings: number
  /** A brace-less `if`/`else`/`for`/`while` body gained its braces. */
  readonly bracedBodies: number
  /** `catch (e)` became `catch`, the unused binding dropped. */
  readonly unboundCatches: number
  /** A global numeric function became its `Number` property. */
  readonly numberProperties: number
  /** `{ name: name }` was shorthand; qualifying the value spells the property out again. */
  readonly shorthandProperties: number
  /**
   * An inner binding that shadowed a document variable stopped being a shadow once that variable
   * moved onto the scope, so the printer stopped renaming it.
   */
  readonly unshadowedNames: number
}

/**
 * The bindings the printer renamed on the baseline and leaves alone in the modules, listed.
 *
 * A parameter named for a document variable shadowed it while both lived in one function scope, so
 * the printer gave the inner one a decimal suffix; once the outer name is a scope field there is no
 * shadow and the inner one keeps its own name. Listed rather than matched by shape: a rule that
 * accepted any `name2` facing `name` would also accept an unrelated rename that happens to end in a
 * digit, which is a changed program, not a normalisation.
 *
 * One entry covers all seven sites the whole script has: the `term` parameter of
 * `attachTerminalQueryReplyBridge` in `query-reply.ts` and its six uses.
 */
const UNSHADOWED_RENAMES: readonly {
  readonly baseline: string
  readonly generated: string
  readonly module: string
}[] = [{ baseline: 'term2', generated: 'term', module: 'query-reply' }]

/** Whether this exact baseline-to-generated pair is one of the listed unshadowed renames. */
function isListedUnshadowedRename(baseline: string, generated: string): boolean {
  return UNSHADOWED_RENAMES.some(
    (entry) => entry.baseline === baseline && entry.generated === generated
  )
}

/**
 * The globals `unicorn/prefer-number-properties` moves onto `Number`.
 *
 * Measured over the whole script: seventeen sites, and the rule is the only one of its kind that
 * appears often enough to be worth matching. Each is equivalent here because every call is already
 * behind a `typeof … === 'number'` check or is parsing a string, which is what the `Number` form
 * does with no coercion of its own.
 */
const NUMBER_GLOBALS = new Set(['isFinite', 'isNaN', 'parseInt', 'parseFloat'])

export type TerminalDocumentEquivalence =
  | { readonly equivalent: true; readonly normalisations: TerminalDocumentNormalisations }
  | { readonly equivalent: false; readonly reason: string }

/**
 * `baseline` is the script as it stood before the move, `candidate` the one the modules generate.
 *
 * The qualifier is read from `qualifier`, not assumed, so the test names the object it expects and
 * a rename cannot quietly satisfy this.
 */
/** The statement heads `curly` braces: everything whose body may be a single unbraced statement. */
const BRACEABLE_HEAD_KEYWORDS = new Set(['if', 'for', 'while'])

/**
 * Whether the `{` at `open` is the body of a braceable head rather than some other block.
 *
 * `else` and `do` are followed by their body directly. The rest put a parenthesised head first, so
 * the `)` is walked back to its `(` and the keyword before that is what decides. Without this a
 * bare block anywhere in the generated script would be absorbed as a linter-added body, when it is
 * a statement the baseline does not have.
 */
function isBraceableHeadBody(tokens: readonly DocumentToken[], open: number): boolean {
  const previous = tokens[open - 1]
  if (previous === undefined) {
    return false
  }
  if (previous.label === 'else' || previous.label === 'do') {
    return true
  }
  if (previous.label !== ')') {
    return false
  }
  let depth = 0
  for (let i = open - 1; i >= 0; i--) {
    const label = tokens[i]?.label
    if (label === ')') {
      depth += 1
      continue
    }
    if (label === '(') {
      depth -= 1
      if (depth === 0) {
        return BRACEABLE_HEAD_KEYWORDS.has(tokens[i - 1]?.label ?? '')
      }
    }
  }
  return false
}

/** The index of the `}` closing the `{` at `open`, or -1 when the generated script has none. */
function matchingCloseIndex(tokens: readonly DocumentToken[], open: number): number {
  let depth = 0
  for (let i = open; i < tokens.length; i++) {
    const label = tokens[i]?.label
    if (label === '{') {
      depth += 1
      continue
    }
    if (label === '}') {
      depth -= 1
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

export function compareTerminalDocumentScripts(
  baseline: string,
  candidate: string,
  qualifier: string
): TerminalDocumentEquivalence {
  const baselineTokens = readScriptTokens(baseline, 'the baseline')
  if (!baselineTokens.ok) {
    return { equivalent: false, reason: baselineTokens.reason }
  }
  const candidateTokens = readScriptTokens(candidate, 'the generated script')
  if (!candidateTokens.ok) {
    return { equivalent: false, reason: candidateTokens.reason }
  }
  const before = baselineTokens.tokens
  const after = candidateTokens.tokens
  let qualifiedReferences = 0
  let scopeFieldDeclarations = 0
  let rebindings = 0
  let bracedBodies = 0
  let unboundCatches = 0
  let numberProperties = 0
  let shorthandProperties = 0
  let unshadowedNames = 0
  // The generated index each inserted `{` expects its `}` at, innermost last. Recording the index
  // rather than counting means an absorbed close is the one that closes that body and no other.
  const insertedBraceCloses: number[] = []
  let lastMatched: DocumentToken | undefined
  let left = 0
  let right = 0
  while (left < before.length && right < after.length) {
    const expected = before[left]
    const actual = after[right]
    // Ahead of the equality check on purpose: the baseline's next token is a `}` too wherever a
    // braced body ends a block, and this index is known to close the inserted body, so matching
    // them as a pair would consume the wrong one and leave the counts right for the wrong reason.
    if (actual.label === '}' && insertedBraceCloses.at(-1) === right) {
      insertedBraceCloses.pop()
      right += 1
      continue
    }
    if (expected.label === actual.label && expected.text === actual.text) {
      lastMatched = expected
      left += 1
      right += 1
      continue
    }
    // `term2` -> `term`: the printer disambiguated a shadowed binding on the baseline side, and
    // qualifying the outer name removed the shadow, so the inner one keeps its own name.
    if (
      expected.label === 'name' &&
      actual.label === 'name' &&
      isListedUnshadowedRename(expected.text, actual.text)
    ) {
      unshadowedNames += 1
      lastMatched = actual
      left += 1
      right += 1
      continue
    }
    // `{ name }` -> `{ name: <qualifier>.name }`: the printer writes the baseline's shorthand back
    // as one token, and qualifying the value makes the property name unavoidable again.
    if (
      actual.label === ':' &&
      lastMatched?.label === 'name' &&
      after[right + 1]?.label === 'name' &&
      after[right + 1]?.text === qualifier &&
      after[right + 2]?.label === '.' &&
      after[right + 3]?.text === lastMatched.text
    ) {
      shorthandProperties += 1
      right += 4
      continue
    }
    // `name` -> `<qualifier>.name`, three tokens for one.
    if (isQualified(after, right, expected, qualifier)) {
      qualifiedReferences += 1
      left += 1
      right += 3
      continue
    }
    // `parseInt` -> `Number.parseInt`, the same shape under a different object.
    if (NUMBER_GLOBALS.has(expected.text) && isQualified(after, right, expected, 'Number')) {
      numberProperties += 1
      left += 1
      right += 3
      continue
    }
    // `var name` -> `<qualifier>.name`: the declaration itself moved onto the scope object.
    if (
      expected.label === 'var' &&
      before[left + 1] !== undefined &&
      isQualified(after, right, before[left + 1], qualifier)
    ) {
      scopeFieldDeclarations += 1
      left += 2
      right += 3
      continue
    }
    // `var a = 1, b = 2` where both moved onto the scope: the comma introduces the second
    // declaration, which is written as its own assignment.
    if (
      expected.label === ',' &&
      before[left + 1] !== undefined &&
      isQualified(after, right, before[left + 1], qualifier)
    ) {
      scopeFieldDeclarations += 1
      left += 2
      right += 3
      continue
    }
    if (expected.label === 'var' && isBlockScopedKeyword(actual)) {
      rebindings += 1
      lastMatched = actual
      left += 1
      right += 1
      continue
    }
    // `catch (e) {` -> `catch {`: three baseline tokens the linted form does not carry.
    if (
      lastMatched?.label === 'catch' &&
      expected.label === '(' &&
      before[left + 1]?.label === 'name' &&
      before[left + 2]?.label === ')' &&
      actual.label === '{'
    ) {
      unboundCatches += 1
      left += 3
      continue
    }
    // `if (a) b;` -> `if (a) { b; }`: the body the repository's `curly` rule braced. Only a
    // braceable head's body qualifies, and only that body's own close is absorbed.
    if (actual.label === '{' && isBraceableHeadBody(after, right)) {
      const close = matchingCloseIndex(after, right)
      if (close !== -1) {
        bracedBodies += 1
        insertedBraceCloses.push(close)
        right += 1
        continue
      }
    }
    return {
      equivalent: false,
      reason: `token ${left}: expected ${describeToken(expected)}, generated ${describeToken(actual)}`
    }
  }
  // A body braced at the very end of the script leaves its close after the baseline has run out.
  while (insertedBraceCloses.at(-1) === right && after[right]?.label === '}') {
    insertedBraceCloses.pop()
    right += 1
  }
  if (left !== before.length || right !== after.length) {
    return {
      equivalent: false,
      reason: `length: ${before.length - left} token(s) left in the baseline, ${after.length - right} in the generated script`
    }
  }
  if (insertedBraceCloses.length !== 0) {
    return {
      equivalent: false,
      reason: `${insertedBraceCloses.length} inserted brace(s) never closed`
    }
  }
  return {
    equivalent: true,
    normalisations: {
      qualifiedReferences,
      scopeFieldDeclarations,
      rebindings,
      bracedBodies,
      unboundCatches,
      numberProperties,
      shorthandProperties,
      unshadowedNames
    }
  }
}

/**
 * Whether a token is the `const` or `let` a `var` became.
 *
 * `let` is contextual outside strict mode, so acorn reports it as a name rather than as a keyword;
 * matching on the label alone would refuse every `let` the linter introduced.
 */
function isBlockScopedKeyword(token: DocumentToken): boolean {
  return token.label === 'const' || (token.label === 'name' && token.text === 'let')
}

/** Whether the generated stream reads `<qualifier>.<expected>` where the baseline read `expected`. */
function isQualified(
  after: DocumentToken[],
  right: number,
  expected: DocumentToken,
  qualifier: string
): boolean {
  return (
    after[right]?.label === 'name' &&
    after[right]?.text === qualifier &&
    after[right + 1]?.label === '.' &&
    after[right + 2]?.label === expected.label &&
    after[right + 2]?.text === expected.text
  )
}

/**
 * The hand-written script out of the whole document, which is the part C7.1 moves.
 *
 * Read by locating the generated engine rather than by an index into the text, so a slice added
 * above or below it does not silently shift what gets compared.
 */
export function readTerminalDocumentScript(document: string, engineJs: string): string {
  const opener = `<script>${engineJs}</script>`
  const start = document.indexOf(opener)
  if (start === -1) {
    throw new Error('the document does not carry the generated engine script')
  }
  const scriptStart = document.indexOf('<script>', start + opener.length)
  const scriptEnd = document.lastIndexOf('</script>')
  if (scriptStart === -1 || scriptEnd <= scriptStart) {
    throw new Error('the document does not carry a hand-written script after the engine')
  }
  return document.slice(scriptStart + '<script>'.length, scriptEnd)
}
