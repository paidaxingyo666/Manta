/**
 * `translate()` must never run at module scope.
 *
 * A module-level call evaluates once, at import time — before the UI language
 * has been resolved from the device or the stored preference. Whatever English
 * it returns is frozen into a `const` for the life of the process, and
 * switching language silently does nothing for that string.
 *
 * This is the default output of the extraction script on any module-level
 * constant, not an edge case: the first run produced exactly this shape on an
 * array of source-mode labels.
 *
 * Detection walks the AST rather than counting brackets. A bracket-depth
 * heuristic looks like it works and does not: the offending call sat inside an
 * array literal, which nests without introducing a function, so depth-based
 * checks skip precisely the case worth catching.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const MOBILE_ROOT = resolve(import.meta.dirname, '..', '..')
const ROOTS = [join(MOBILE_ROOT, 'src'), join(MOBILE_ROOT, 'app')]
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const SKIP_DIRS = new Set(['node_modules', 'ios', 'android', '.expo', 'locales'])
// The runtime declares translate() and documents it; generated webview bundles
// carry CSS transforms that read the same to a text scan.
const SKIP_FILE = /(^|\/)i18n\/|\.generated\./

const FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor
])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue
    }
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (
      SOURCE_EXTENSIONS.has(extname(entry)) &&
      !entry.includes('.test.') &&
      !SKIP_FILE.test(full)
    ) {
      out.push(full)
    }
  }
  return out
}

/** Lines with a `translate(...)` call that no function encloses. */
export function topLevelTranslateLines(fileName: string, source: string): number[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const hits: number[] = []

  const visit = (node: ts.Node, insideFunction: boolean): void => {
    const nowInside = insideFunction || FUNCTION_KINDS.has(node.kind)
    if (
      !nowInside &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'translate'
    ) {
      hits.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
    }
    node.forEachChild((child) => visit(child, nowInside))
  }
  visit(file, false)
  return hits
}

describe('no top-level translate', () => {
  it('never calls translate() at module scope', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        for (const line of topLevelTranslateLines(file, readFileSync(file, 'utf8'))) {
          offenders.push(`${relative(MOBILE_ROOT, file)}:${line}`)
        }
      }
    }
    expect(
      offenders,
      'move these inside a function so they re-evaluate on language change'
    ).toEqual([])
  })

  it('catches the shapes a bracket-depth check misses', () => {
    // Each of these evaluates at import time. The array case is the one that
    // actually shipped from the extraction script and slipped past the first
    // version of this guard.
    expect(topLevelTranslateLines('a.ts', 'const a = translate("k", "Smart")')).toEqual([1])
    expect(topLevelTranslateLines('a.ts', 'const a = [\n  translate("k", "Smart")\n]')).toEqual([2])
    expect(
      topLevelTranslateLines('a.ts', 'const o = {\n  label: translate("k", "Smart")\n}')
    ).toEqual([2])
  })

  it('allows calls a function encloses', () => {
    expect(
      topLevelTranslateLines('a.ts', 'function f() {\n  return translate("k", "Smart")\n}')
    ).toEqual([])
    expect(
      topLevelTranslateLines('a.tsx', 'const C = () => <p>{translate("k", "Smart")}</p>')
    ).toEqual([])
    expect(topLevelTranslateLines('a.ts', 'const f = () => [translate("k", "Smart")]')).toEqual([])
  })
})
