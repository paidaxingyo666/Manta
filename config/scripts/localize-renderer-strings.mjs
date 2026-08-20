import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

import { collectLocalizationCandidates } from './audit-localization-coverage.mjs'

// Why per-target: the renderer resolves `@/*` through its vite/vitest alias,
// the mobile tree declares the path in tsconfig only — Metro and vitest both
// fail on it — so mobile gets a relative specifier computed per file.
function relativeI18nSpecifier(runtimeRelativePath) {
  return (filePath, root) => {
    const from = path.dirname(filePath)
    const to = path.resolve(root, runtimeRelativePath)
    const rel = path.relative(from, to).split(path.sep).join('/')
    return rel.startsWith('.') ? rel : `./${rel}`
  }
}

function keySegment(value) {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]+/g, '.')
    .replace(/(^\.+|\.+$)/g, '')
}

// A template literal and a plain string can share `candidate.text` ("Allow"
// from `Allow ${tool}?` and from 'Allow'), so the base hash collides and the
// catalog keeps only whichever was written last — both call sites then render
// the same wrong text. Suffix every member of a colliding group rather than
// letting one keep the base key: the winner would otherwise be decided by
// source order and shift whenever the file is edited.
function disambiguateKeys(entries, keyStyle) {
  const fallbacksByBase = new Map()
  for (const { candidate, translation } of entries) {
    const base = keyForCandidate(candidate, keyStyle)
    const seen = fallbacksByBase.get(base) ?? new Set()
    seen.add(translation.fallback)
    fallbacksByBase.set(base, seen)
  }
  return (candidate, fallback) => {
    const base = keyForCandidate(candidate, keyStyle)
    if ((fallbacksByBase.get(base)?.size ?? 0) < 2) {
      return base
    }
    return `${base}.${createHash('sha1').update(fallback).digest('hex').slice(0, 6)}`
  }
}

// Why the mobile tree gets a shorter shape: the key is the longest part of a
// `translate()` call, and a long one pushes the call past the formatter's line
// width, which then splits it across three lines. Multiplied over a thousand
// call sites that is thousands of lines, and it pushed fifteen files past
// their max-lines ratchet. The hash already carries the full path, so the
// readable segment only has to disambiguate for a human reading a diff — the
// file's own name does that.
function keyForCandidate(candidate, keyStyle = 'path') {
  const source = `${candidate.filePath}:${candidate.text}`
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 10)
  if (keyStyle === 'short') {
    const basename = candidate.filePath.split('/').at(-1) ?? candidate.filePath
    return `m.${keySegment(basename)}.${hash}`
  }
  // Strip whichever tree the file came from so keys read as a path inside it,
  // and so an identical string in both apps does not collide on one key.
  const withoutPrefix = candidate.filePath
    .replace(/^src\/renderer\/src\//, '')
    .replace(/^mobile\//, 'mobile.')
  return `auto.${keySegment(withoutPrefix)}.${hash}`
}

function setCatalogValue(catalog, key, value) {
  const parts = key.split('.')
  let current = catalog
  for (const part of parts.slice(0, -1)) {
    current[part] ??= {}
    current = current[part]
  }
  current[parts.at(-1)] = value
}

function translateCall(key, value, options) {
  if (options) {
    return `translate(${JSON.stringify(key)}, ${JSON.stringify(value)}, ${options})`
  }
  return `translate(${JSON.stringify(key)}, ${JSON.stringify(value)})`
}

function isInsideJsxExpression(node) {
  let current = node.parent
  while (current) {
    if (ts.isJsxExpression(current)) {
      return true
    }
    current = current.parent
  }
  return false
}

function editForCandidate(candidate, key, translation, sourceFile) {
  const call = translateCall(key, translation.fallback, translation.options)
  const node = findNodeByRange(sourceFile, candidate.start, candidate.end)
  if (candidate.kind === 'jsx-text') {
    // The candidate range keeps the node's trailing whitespace but the fallback
    // is compacted, so replacing the whole range drops a space that separated
    // the text from the next expression — "Connects to {host}" renders glued.
    const raw = sourceFile.text.slice(candidate.start, candidate.end)
    const trailing = /\s*$/.exec(raw)[0]
    return { start: candidate.start, end: candidate.end, text: `{${call}}${trailing}` }
  }
  if (candidate.kind === 'jsx-expression') {
    return { start: candidate.start, end: candidate.end, text: call }
  }
  if (candidate.kind.startsWith('jsx-attribute:')) {
    if (node?.parent && ts.isJsxAttribute(node.parent) && node.parent.initializer === node) {
      return { start: node.getStart(sourceFile), end: node.getEnd(), text: `{${call}}` }
    }
    if (node && isInsideJsxExpression(node)) {
      return { start: candidate.start, end: candidate.end, text: call }
    }
    return { start: candidate.start, end: candidate.end, text: `{${call}}` }
  }
  return { start: candidate.start, end: candidate.end, text: call }
}

function sourceKindForPath(filePath) {
  return filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS
}

function findNodeByRange(sourceFile, start, end) {
  let match

  function visit(node) {
    if (node.getStart(sourceFile) === start && node.getEnd() === end) {
      match = node
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return match
}

function translationForCandidate(candidate, sourceFile) {
  if (!candidate.dynamic) {
    return { fallback: candidate.text }
  }

  const node = findNodeByRange(sourceFile, candidate.start, candidate.end)
  if (!node || !ts.isTemplateExpression(node)) {
    return null
  }

  const options = {}
  let fallback = node.head.text
  node.templateSpans.forEach((span, index) => {
    const optionName = `value${index}`
    options[optionName] = span.expression.getText(sourceFile)
    fallback += `{{${optionName}}}${span.literal.text}`
  })

  const optionSource = `{ ${Object.entries(options)
    .map(([name, expression]) => `${name}: ${expression}`)
    .join(', ')} }`

  return { fallback, options: optionSource }
}

function hasTranslateImport(sourceText) {
  return /import\s*\{[^}]*\btranslate\b[^}]*\}\s*from\s*['"][^'"]*i18n\/i18n['"]/.test(sourceText)
}

function addTranslateImport(sourceText, specifier) {
  if (hasTranslateImport(sourceText)) {
    return sourceText
  }
  const TRANSLATE_IMPORT = `import { translate } from '${specifier}'\n`

  const importMatches = [...sourceText.matchAll(/^import[\s\S]*?from\s*['"][^'"]+['"]\n/gm)]
  if (importMatches.length === 0) {
    return `${TRANSLATE_IMPORT}${sourceText}`
  }

  const lastImport = importMatches.at(-1)
  const insertAt = (lastImport.index ?? 0) + lastImport[0].length
  return `${sourceText.slice(0, insertAt)}${TRANSLATE_IMPORT}${sourceText.slice(insertAt)}`
}

function uniqueCandidates(candidates) {
  const seen = new Set()
  const unique = []

  for (const candidate of candidates) {
    const signature = `${candidate.start}:${candidate.end}:${candidate.kind}`
    if (!seen.has(signature)) {
      seen.add(signature)
      unique.push(candidate)
    }
  }

  return unique
}

const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor
])

/**
 * Positions that no function encloses.
 *
 * Rewriting one of these produces a `translate()` that runs at import time,
 * before the UI language is known, freezing English into a module constant for
 * the life of the process. It reads identically to correct code — the only
 * difference is where it sits — so it has to be excluded here rather than
 * found in review. Callers report the skips so the strings are not simply lost.
 */
function moduleScopeRanges(sourceFile) {
  const ranges = []
  const visit = (node, insideFunction) => {
    const nowInside = insideFunction || FUNCTION_KINDS.has(node.kind)
    if (!nowInside && ts.isStringLiteralLike(node)) {
      ranges.push([node.getStart(sourceFile), node.getEnd()])
    }
    node.forEachChild((child) => visit(child, nowInside))
  }
  visit(sourceFile, false)
  return ranges
}

function applyReplacements(filePath, sourceText, candidates, catalog, skipped, specifier) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourceKindForPath(filePath)
  )
  const moduleScope = moduleScopeRanges(sourceFile)
  const atModuleScope = (candidate) =>
    moduleScope.some(([start, end]) => candidate.start >= start && candidate.start < end)

  // Drop candidates nested inside another candidate. A template literal and a
  // string inside its own interpolation are both reported; rewriting the outer
  // one already carries the inner as an interpolation value, so applying both
  // writes the second edit into text the first just replaced and corrupts the
  // line. Sorting by position is not enough — these ranges contain each other
  // rather than merely touching.
  // Uses the candidate's own node span. `text` is the extracted copy, not the
  // source range, so deriving an end from its length lands in the wrong place
  // for anything quoted, escaped, or interpolated.
  const spans = uniqueCandidates(candidates).map((c) => [c.start, c.end])
  const isNested = (candidate) =>
    spans.some(
      ([start, end]) =>
        (candidate.start > start && candidate.end <= end) ||
        (candidate.start >= start && candidate.end < end)
    )

  const replacements = uniqueCandidates(candidates)
    .filter((candidate) => !isNested(candidate))
    .filter((candidate) => {
      if (!atModuleScope(candidate)) {
        return true
      }
      skipped.push(`${filePath}:${candidate.text}`)
      return false
    })
    .map((candidate) => ({
      candidate,
      translation: translationForCandidate(candidate, sourceFile)
    }))
    .filter((entry) => entry.translation !== null)
    .sort((left, right) => right.candidate.start - left.candidate.start)

  const keyFor = disambiguateKeys(replacements, options.keyStyle)
  let nextSource = sourceText
  for (const { candidate, translation } of replacements) {
    const key = keyFor(candidate, translation.fallback)
    setCatalogValue(catalog, key, translation.fallback)
    const edit = editForCandidate(candidate, key, translation, sourceFile)
    nextSource = `${nextSource.slice(0, edit.start)}${edit.text}${nextSource.slice(edit.end)}`
  }

  return replacements.length > 0 ? addTranslateImport(nextSource, specifier) : nextSource
}

async function localizeFile(root, filePath, catalog, skipped, i18nSpecifier, options) {
  const sourceText = await fs.readFile(filePath, 'utf8')
  const candidates = collectLocalizationCandidates(filePath, sourceText, root, options)
  if (candidates.length === 0) {
    return 0
  }
  const before = skipped.length
  const nextSource = applyReplacements(
    filePath,
    sourceText,
    candidates,
    catalog,
    skipped,
    i18nSpecifier(filePath, root)
  )
  const replacedCount = uniqueCandidates(candidates).length - (skipped.length - before)
  if (nextSource !== sourceText) {
    await fs.writeFile(filePath, nextSource)
  }
  return replacedCount
}

async function collectCandidateFiles(root, relativeSourceRoot) {
  const sourceRoot = path.join(root, relativeSourceRoot)
  const reports = []
  const stack = [sourceRoot]
  while (stack.length > 0) {
    const dir = stack.pop()
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (
          !['.git', 'assets', 'dist', 'node_modules', 'out', '__snapshots__'].includes(entry.name)
        ) {
          stack.push(fullPath)
        }
        continue
      }
      if (
        entry.isFile() &&
        /\.(?:ts|tsx|js|jsx|mts|cts)$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.includes('.test.') &&
        !entry.name.includes('.spec.')
      ) {
        reports.push(fullPath)
      }
    }
  }
  return reports
}

// Why parameterised: the mobile app needs the identical rewrite, and a second
// copy of this script would drift from the first. Both trees resolve
// copy of this script would drift from the first.
const TARGETS = {
  renderer: {
    sourceRoot: path.join('src', 'renderer', 'src'),
    catalog: path.join('src', 'renderer', 'src', 'i18n', 'locales', 'en.json'),
    i18nSpecifier: () => '@/i18n/i18n'
  },
  mobile: {
    // Resolved per call, not at import: a test that points the pipeline at a
    // fixture tree sets this after the module is already loaded.
    get sourceRoot() {
      return process.env.MOBILE_I18N_SUBTREE || 'mobile'
    },
    catalog: path.join('mobile', 'src', 'i18n', 'locales', 'en.json'),
    i18nSpecifier: relativeI18nSpecifier(path.join('mobile', 'src', 'i18n', 'i18n')),
    extraCopyRules: true,
    keyStyle: 'short'
  }
}

export async function main(root = process.cwd(), argv = process.argv.slice(2)) {
  const name = argv.includes('--target') ? argv[argv.indexOf('--target') + 1] : 'renderer'
  const target = TARGETS[name]
  if (!target) {
    console.error(`Unknown target '${name}'. Expected one of: ${Object.keys(TARGETS).join(', ')}`)
    return 1
  }
  const catalogPath = path.join(root, target.catalog)
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
  const files = await collectCandidateFiles(root, target.sourceRoot)
  const skipped = []
  let count = 0

  for (const filePath of files) {
    count += await localizeFile(root, filePath, catalog, skipped, target.i18nSpecifier, {
      extraCopyRules: target.extraCopyRules === true,
      keyStyle: target.keyStyle ?? 'path'
    })
  }

  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
  console.log(`Localized ${count} ${name} string candidates.`)
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} at module scope; they need a function or a lazy getter:`)
    for (const entry of skipped.slice(0, 20)) {
      console.log(`  ${entry}`)
    }
    if (skipped.length > 20) {
      console.log(`  … and ${skipped.length - 20} more`)
    }
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
