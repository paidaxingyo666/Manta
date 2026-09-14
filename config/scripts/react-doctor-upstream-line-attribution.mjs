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

/**
 * A multi-line finding reports its first line, which is often too generic to
 * identify (`return {`, `db`). Such a line is attributed together with the lines
 * after it, up to the first identifying one, as a block upstream must contain
 * contiguously. 86 casts in upstream's own tests failed the 2026-09-14 sync
 * because only the opening line was compared.
 */
const MAX_BLOCK_LINES = 12

/** The upstream spelling of a path the mirror renamed (`manta-runtime-tests/`). */
function upstreamPathCandidates(filePath) {
  const renamed = normalizeBrand(filePath)
    .split('Manta')
    .join('Orca')
    .split('manta')
    .join('orca')
    .split('MANTA')
    .join('ORCA')
  return renamed === filePath ? [filePath] : [filePath, renamed]
}

function upstreamFileLines(ref, filePath, cache) {
  if (!cache.has(filePath)) {
    let lines = null
    for (const candidate of upstreamPathCandidates(filePath)) {
      const shown = spawnSync('git', ['show', `${ref}:${candidate}`], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      })
      if (shown.status === 0) {
        lines = shown.stdout.split('\n').map(normalizeBrand)
        break
      }
    }
    cache.set(filePath, lines && { lines, set: new Set(lines) })
  }
  return cache.get(filePath)
}

/**
 * True when the finding at `index` (0-based) is upstream's: its line, or the
 * block from it through the next identifying line, appears in upstream's copy.
 */
export function isUpstreamAuthored(sourceLines, index, upstream) {
  if (index < 0 || index >= sourceLines.length) {
    return false
  }
  const block = []
  for (
    let cursor = index;
    cursor < sourceLines.length && block.length < MAX_BLOCK_LINES;
    cursor++
  ) {
    const line = normalizeBrand(sourceLines[cursor])
    block.push(line)
    if (line.length >= MIN_ATTRIBUTABLE_LENGTH) {
      break
    }
  }
  if (block.at(-1).length < MIN_ATTRIBUTABLE_LENGTH) {
    return false
  }
  if (block.length === 1) {
    return upstream.set.has(block[0])
  }
  for (let start = 0; start + block.length <= upstream.lines.length; start++) {
    if (block.every((line, offset) => upstream.lines[start + offset] === line)) {
      return true
    }
  }
  return false
}

function sourceLines(filePath, cache) {
  if (!cache.has(filePath)) {
    try {
      cache.set(filePath, readFileSync(filePath, 'utf8').split('\n'))
    } catch {
      cache.set(filePath, null)
    }
  }
  return cache.get(filePath)
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
    const lines = sourceLines(filePath, sourceCache)
    if (known && lines && isUpstreamAuthored(lines, diagnostic.line - 1, known)) {
      upstream.push(diagnostic)
    } else {
      ours.push(diagnostic)
    }
  }
  return { ours, upstream }
}
