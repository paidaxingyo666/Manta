/**
 * A zh entry that is byte-identical to its English source is usually a hole,
 * not a decision.
 *
 * The catalog gate only asks whether a key exists, so a value copied from
 * English counts as "translated" and the coverage number reads 100% while the
 * screen still shows English. That is exactly how five long descriptions
 * shipped untranslated: a key migration back-filled the English text into an
 * empty zh catalog, and the later translation pass skipped every key that
 * already had a value.
 *
 * Anything that genuinely stays in English has to be listed here, so the
 * decision is visible in review rather than indistinguishable from a mistake.
 */
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

import { TECHNICAL_LITERALS } from './technical-literals'

// Beyond the shared identifier list, a handful of one-word labels read the same
// in both languages in this product's context.
const ALSO_UNTRANSLATED = new Set<string>([])

const INTENTIONALLY_UNTRANSLATED = new Set([...TECHNICAL_LITERALS, ...ALSO_UNTRANSLATED])

type Catalog = Record<string, unknown>

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

describe('zh catalog', () => {
  it('has no entry silently left at its English source text', () => {
    const english = flatten(en as Catalog)
    const untranslated: string[] = []
    for (const [key, translated] of flatten(zh as Catalog)) {
      const source = english.get(key)
      if (source === translated && !INTENTIONALLY_UNTRANSLATED.has(source)) {
        untranslated.push(`${key} — "${source}"`)
      }
    }
    expect(
      untranslated,
      'translate these, or add them to INTENTIONALLY_UNTRANSLATED with a reason'
    ).toEqual([])
  })
})
