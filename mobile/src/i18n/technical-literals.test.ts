/**
 * Some English strings must survive translation unchanged.
 *
 * Brand names, CLI tokens, and file extensions are identifiers, not prose.
 * "GitHub" translated into any language is still GitHub, and a translator who
 * renders it phonetically produces a label that no longer matches the thing it
 * points at. The first extraction run here pulled "GitHub", "GitLab" and
 * "Linear" straight into the catalog, so this is the expected default, not an
 * edge case.
 *
 * The rule is deliberately narrow: it only fires where the *English* value is
 * itself a known literal. Ordinary prose that happens to contain a brand name
 * is left alone, because that sentence does need translating.
 */
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'
import { TECHNICAL_LITERALS } from './technical-literals'

type Catalog = Record<string, unknown>

/** Flattens the nested catalog into dotted keys. */
function flatten(catalog: Catalog, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      out.set(path, value)
    } else if (value && typeof value === 'object') {
      for (const [k, v] of flatten(value as Catalog, path)) {
        out.set(k, v)
      }
    }
  }
  return out
}

describe('technical literals', () => {
  const english = flatten(en as Catalog)

  it('keeps literal-valued entries identical in every locale', () => {
    const drifted: string[] = []
    for (const [locale, catalog] of Object.entries({ zh })) {
      for (const [key, translated] of flatten(catalog as Catalog)) {
        const source = english.get(key)
        if (source && TECHNICAL_LITERALS.has(source) && translated !== source) {
          drifted.push(`${locale}:${key} — "${source}" became "${translated}"`)
        }
      }
    }
    expect(drifted, 'these are identifiers, not prose').toEqual([])
  })

  it('does not touch prose that merely mentions a brand', () => {
    // The guard must stay narrow, or it blocks the translations that matter.
    const prose = 'Sign in to GitHub'
    expect(TECHNICAL_LITERALS.has(prose)).toBe(false)
    expect(TECHNICAL_LITERALS.has('GitHub')).toBe(true)
  })
})
