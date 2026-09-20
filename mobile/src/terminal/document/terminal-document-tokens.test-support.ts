import { tokenizer } from 'acorn'
import { transformSync } from 'esbuild'

/**
 * Reading a version of the in-WebView document script as a token stream.
 *
 * Kept apart from the comparison that consumes it: this side answers what the script says, and
 * says nothing about which differences between two of them are allowed.
 */
/** One token as this comparison reads it: what kind it is, and the text it carried. */
export type DocumentToken = { readonly label: string; readonly text: string }

/**
 * Acorn's `Token` class declares `type`, `start` and `end` and not `value`, which it does carry,
 * so the field is read through a narrowing check rather than asserted onto the declared type.
 */
function readDocumentToken(token: unknown): DocumentToken | null {
  if (typeof token !== 'object' || token === null || !('type' in token) || !('value' in token)) {
    return null
  }
  const type: unknown = token.type
  if (typeof type !== 'object' || type === null || !('label' in type)) {
    return null
  }
  const label: unknown = type.label
  if (typeof label !== 'string') {
    return null
  }
  const value: unknown = token.value
  return { label, text: value === undefined || value === null ? '' : String(value) }
}

/** The directive prepended to both sides, and checked to have survived printing. */
const STRICT_DIRECTIVE = 'use strict'

/**
 * Both sides are printed by the generator's own printer before being read.
 *
 * Otherwise every choice the printer makes — semicolons, property shorthand, quote style — reads as
 * a difference in the program, when it is a difference in who typed it. Printing both sides with
 * one printer removes that whole class by construction rather than by a rule per symptom, and
 * leaves only what the eight counted classes cover.
 */
function significantTokens(source: string): DocumentToken[] {
  // Read strict on both sides. A loose script has to defend Annex B's block-scoped function
  // declarations, and the printer does that by hoisting a `var` and renaming the function; a module
  // does not, so one side would carry a rename the other cannot. Neither name escapes its block, so
  // the two readings agree on behaviour and only the strict one can be compared.
  const printed = transformSync(`'${STRICT_DIRECTIVE}';\n${source}`, {
    loader: 'js',
    target: 'chrome74',
    minify: false
  }).code
  const kept: DocumentToken[] = []
  for (const raw of tokenizer(printed, { ecmaVersion: 2020 })) {
    const token = readDocumentToken(raw)
    if (token === null) {
      throw new Error('acorn produced a token this comparison cannot read')
    }
    if (token.label === ';' || token.label === 'eof') {
      continue
    }
    kept.push(token)
  }
  if (kept[0]?.text !== STRICT_DIRECTIVE) {
    throw new Error('the strict directive this comparison prepends did not survive printing')
  }
  return kept.slice(1)
}

/**
 * The tokens of one side, or the reason it could not be read.
 *
 * A script that does not parse is a refusal with the printer's own message rather than an
 * exception out of the comparison: a generator that emitted something broken should say so where
 * the other differences are reported.
 */
export function readScriptTokens(
  source: string,
  side: string
): { ok: true; tokens: DocumentToken[] } | { ok: false; reason: string } {
  try {
    return { ok: true, tokens: significantTokens(source) }
  } catch (error) {
    return {
      ok: false,
      reason: `${side} does not parse: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    }
  }
}

export function describeToken(token: DocumentToken | undefined): string {
  return token === undefined ? '(end of script)' : `${token.label} ${token.text}`.trim()
}
