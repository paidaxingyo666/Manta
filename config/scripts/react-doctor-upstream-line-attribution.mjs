import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Whose line is this — upstream's, or this fork's?
 *
 * Manta carries upstream's source verbatim apart from the rename, so a sync PR
 * presents thousands of upstream-authored lines as "changed" and the
 * changed-lines gate judges this fork on code it did not write and cannot fix:
 * amending it guarantees a conflict at the next sync, and the patterns are
 * upstream's deliberate style (every one of the 14 errors that blocked the
 * 2026-08-27 sync was a documented `ref.current = prop` in an upstream file).
 *
 * Attribution is by line CONTENT, not by blame: a cherry-pick rewrites the SHA,
 * so blame names a commit this fork made even when upstream wrote the line.
 */

/** Brand spellings the rename swaps, so a renamed line still matches its twin. */
const BRAND_PAIRS = [
  ['Orca', 'Manta'],
  ['orca', 'manta'],
  ['ORCA', 'MANTA']
]

/**
 * Below this, a line is too generic to attribute — `}`, `return`, a lone brace
 * appears in every file, and matching one would silently excuse a real finding.
 * Short lines are treated as this fork's, which errs toward reporting.
 */
const MIN_ATTRIBUTABLE_LENGTH = 12

function normalizeBrand(text) {
  let out = text
  for (const [from, to] of BRAND_PAIRS) {
    out = out.split(from).join(to)
  }
  return out.trim()
}

function upstreamFileLines(ref, filePath, cache) {
  if (!cache.has(filePath)) {
    const shown = spawnSync('git', ['show', `${ref}:${filePath}`], { encoding: 'utf8' })
    cache.set(
      filePath,
      shown.status === 0 ? new Set(shown.stdout.split('\n').map(normalizeBrand)) : null
    )
  }
  return cache.get(filePath)
}

function sourceLine(filePath, line, cache) {
  if (!cache.has(filePath)) {
    try {
      cache.set(filePath, readFileSync(filePath, 'utf8').split('\n'))
    } catch {
      cache.set(filePath, null)
    }
  }
  const lines = cache.get(filePath)
  return lines && line >= 1 && line <= lines.length ? lines[line - 1] : null
}

export function upstreamRefIsAvailable(ref) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status === 0
}

/**
 * Splits diagnostics into the ones this fork owns and the ones upstream does.
 *
 * A diagnostic belongs to upstream when the exact line it points at also exists
 * in upstream's copy of the same file. Anything else — a file upstream does not
 * have, a line this fork wrote, a line too short to identify — stays ours.
 */
export function partitionByAuthor(diagnostics, upstreamRef) {
  const upstreamCache = new Map()
  const sourceCache = new Map()
  const ours = []
  const upstream = []
  for (const diagnostic of diagnostics) {
    const filePath = diagnostic.filePath
    const known = upstreamFileLines(upstreamRef, filePath, upstreamCache)
    const line = sourceLine(filePath, diagnostic.line, sourceCache)
    const attributable = line !== null && normalizeBrand(line).length >= MIN_ATTRIBUTABLE_LENGTH
    if (known && attributable && known.has(normalizeBrand(line))) {
      upstream.push(diagnostic)
    } else {
      ours.push(diagnostic)
    }
  }
  return { ours, upstream }
}
