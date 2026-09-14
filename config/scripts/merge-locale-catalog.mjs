#!/usr/bin/env node
/**
 * Three-way merge of a renderer locale catalogue, key by key.
 *
 * The sync used to merge these with `keepupstream`, which on any two-sided
 * change replaced the fork's file with upstream's. Upstream edits zh.json in
 * most weeks, so every sync silently deleted every translation the fork had
 * added — 603 zh entries and 95 English fallbacks for fork-only features in the
 * 2026-09-14 sync alone. A line merge is no better: adjacent keys in a JSON
 * object conflict on commas.
 *
 * Per leaf key: a side that did not change it defers to the side that did,
 * including a deletion. When both changed it differently, a translation keeps
 * the fork's (written and reviewed here; upstream's are machine output), and
 * English keeps upstream's, because English is what upstream's code declares.
 *
 * As a git merge driver:  node config/scripts/merge-locale-catalog.mjs %O %A %B %P
 * The result is written to %A. Exit 0: every key has an answer by rule.
 */
import fs from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

function flatten(catalog) {
  const leaves = new Map()
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const next = [...path, key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, next)
      } else {
        leaves.set(JSON.stringify(next), value)
      }
    }
  }
  walk(catalog, [])
  return leaves
}

function readCatalog(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return text.trim() ? JSON.parse(text) : {}
  } catch (error) {
    // A side that does not have the file is an empty catalogue, not a failure.
    if (error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

function pick(key, base, ours, theirs, preferOurs, conflicts) {
  const inBase = base.has(key)
  const oursChanged = ours.has(key) !== inBase || ours.get(key) !== base.get(key)
  const theirsChanged = theirs.has(key) !== inBase || theirs.get(key) !== base.get(key)
  const side = (map) => (map.has(key) ? { present: true, value: map.get(key) } : { present: false })
  if (!oursChanged) {
    return side(theirs)
  }
  if (!theirsChanged) {
    return side(ours)
  }
  if (ours.has(key) === theirs.has(key) && ours.get(key) === theirs.get(key)) {
    return side(ours)
  }
  // A key the base had is upstream's. Upstream deleting it means its code no
  // longer asks for it, so a fork translation of it is dead; the fork deleting
  // it changes nothing, because the merged code is upstream's there.
  if (!theirs.has(key)) {
    return side(theirs)
  }
  if (!ours.has(key)) {
    return side(theirs)
  }
  conflicts.push({ key: JSON.parse(key).join('.'), ours: ours.get(key), theirs: theirs.get(key) })
  return side(preferOurs ? ours : theirs)
}

/**
 * Layout follows upstream's file, the side that changes most, so the next sync
 * diffs small; a key only the fork has goes straight after the key that
 * preceded it in the fork's file.
 */
function orderKeys(merged, ours, theirs) {
  const attached = new Map()
  let anchor = null
  for (const key of ours.keys()) {
    if (theirs.has(key) && merged.has(key)) {
      anchor = key
    } else if (merged.has(key) && !theirs.has(key)) {
      const list = attached.get(anchor) ?? []
      list.push(key)
      attached.set(anchor, list)
    }
  }
  const ordered = [...(attached.get(null) ?? [])]
  for (const key of theirs.keys()) {
    if (merged.has(key)) {
      ordered.push(key)
      ordered.push(...(attached.get(key) ?? []))
    }
  }
  return ordered
}

/**
 * A leaf and an object at the same path cannot both be written. Upstream turns
 * a leaf into an object when a string grows a variant, so the deeper form wins
 * and the old leaf — whose English no longer exists — is dropped.
 */
function dropShadowedLeaves(ordered, conflicts) {
  const paths = ordered.map((key) => JSON.parse(key))
  const prefixes = new Set()
  for (const path of paths) {
    for (let length = 1; length < path.length; length += 1) {
      prefixes.add(JSON.stringify(path.slice(0, length)))
    }
  }
  return ordered.filter((key) => {
    if (!prefixes.has(key)) {
      return true
    }
    conflicts.push({ key: JSON.parse(key).join('.'), shadowed: true })
    return false
  })
}

export function mergeLocaleCatalogs(baseCatalog, oursCatalog, theirsCatalog, { isEnglish }) {
  const base = flatten(baseCatalog)
  const ours = flatten(oursCatalog)
  const theirs = flatten(theirsCatalog)
  const conflicts = []
  const merged = new Map()
  for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
    const result = pick(key, base, ours, theirs, !isEnglish, conflicts)
    if (result.present) {
      merged.set(key, result.value)
    }
  }
  const ordered = dropShadowedLeaves(orderKeys(merged, ours, theirs), conflicts)
  const catalog = {}
  for (const key of ordered) {
    const path = JSON.parse(key)
    let cursor = catalog
    for (const part of path.slice(0, -1)) {
      if (!cursor[part] || typeof cursor[part] !== 'object') {
        cursor[part] = {}
      }
      cursor = cursor[part]
    }
    cursor[path.at(-1)] = merged.get(key)
  }
  return { catalog, conflicts }
}

/**
 * Drops translations of keys English no longer has.
 *
 * A key upstream never translated, that the fork then translated, and that
 * upstream later retired from en.json looks like a fork addition from inside
 * the translation file alone — absent at base, absent on upstream's side,
 * present on the fork's. Only en.json knows it is gone, so this runs once the
 * English catalogue is merged, and it is what the catalogue gate calls extra.
 */
export function retireAgainstEnglish(catalog, englishCatalog) {
  const english = flatten(englishCatalog)
  const retired = []
  const prune = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const next = [...path, key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        prune(value, next)
        if (Object.keys(value).length === 0) {
          delete node[key]
        }
      } else if (!english.has(JSON.stringify(next))) {
        retired.push(next.join('.'))
        delete node[key]
      }
    }
  }
  prune(catalog, [])
  return retired
}

function retireMain([englishPath, ...catalogPaths]) {
  const english = readCatalog(englishPath)
  for (const file of catalogPaths) {
    const catalog = readCatalog(file)
    const retired = retireAgainstEnglish(catalog, english)
    if (retired.length > 0) {
      fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`)
      console.log(`${file}: retired ${retired.length} key(s) en.json no longer has`)
    }
  }
  return 0
}

function main(argv) {
  if (argv[0] === '--retire-against') {
    return retireMain(argv.slice(1))
  }
  const [basePath, oursPath, theirsPath, displayPath = oursPath] = argv
  if (!basePath || !oursPath || !theirsPath) {
    console.error(
      'usage: merge-locale-catalog.mjs <base> <ours> <theirs> [path]\n' +
        '       merge-locale-catalog.mjs --retire-against <en.json> <catalog.json>...'
    )
    return 2
  }
  const { catalog, conflicts } = mergeLocaleCatalogs(
    readCatalog(basePath),
    readCatalog(oursPath),
    readCatalog(theirsPath),
    { isEnglish: /(^|[/\\])en\.json$/.test(displayPath) }
  )
  fs.writeFileSync(oursPath, `${JSON.stringify(catalog, null, 2)}\n`)
  if (conflicts.length > 0) {
    console.error(`${displayPath}: ${conflicts.length} two-sided key(s) decided by rule`)
    for (const conflict of conflicts.slice(0, 10)) {
      console.error(`  ${conflict.key}${conflict.shadowed ? ' (leaf replaced by object)' : ''}`)
    }
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
