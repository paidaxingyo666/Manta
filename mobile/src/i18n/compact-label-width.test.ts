/**
 * Some labels sit in space the layout cannot give more of — a window label
 * beside a progress bar, a status line on a host card, a badge. A translation
 * wider than its English source wraps or truncates there, so those entries are
 * held to the English width.
 *
 * Width is counted in half-widths: a CJK glyph occupies two columns, so "5小时"
 * is wider than "5h" even though it has fewer characters.
 */
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

// English source text of every entry rendered somewhere it cannot grow.
const COMPACT_SOURCES = new Set([
  '5h',
  '7d',
  'Manta Relay',
  'Direct · LAN',
  'Direct · Tailscale',
  '{{total}} worktrees',
  '{{total}} worktree',
  '{{total}} worktrees · {{active}} active',
  '{{total}} worktree · {{active}} active',
  'Last known: {{counts}}',
  'Resets now',
  'Resets in {{duration}}',
  'None',
  'API key set'
])

function displayWidth(value: string): number {
  let width = 0
  for (const char of value) {
    width += char.codePointAt(0)! > 0x2e80 ? 2 : 1
  }
  return width
}

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

describe('compact label width', () => {
  const english = flatten(en as Catalog)

  it('keeps translations of compact labels no wider than their source', () => {
    const overflowing: string[] = []
    for (const [key, translated] of flatten(zh as Catalog)) {
      const source = english.get(key)
      if (!source || !COMPACT_SOURCES.has(source)) {
        continue
      }
      if (displayWidth(translated) > displayWidth(source)) {
        overflowing.push(
          `${key} — "${source}" (${displayWidth(source)}) became "${translated}" (${displayWidth(translated)})`
        )
      }
    }
    expect(overflowing, 'shorten these or the layout wraps').toEqual([])
  })

  it('counts a CJK glyph as two columns', () => {
    expect(displayWidth('5h')).toBe(2)
    expect(displayWidth('5小时')).toBe(5)
  })

  it('only lists sources the catalog still has', () => {
    const values = new Set(english.values())
    const stale = [...COMPACT_SOURCES].filter((source) => !values.has(source))
    expect(stale, 'retire these so the list keeps meaning something').toEqual([])
  })
})
