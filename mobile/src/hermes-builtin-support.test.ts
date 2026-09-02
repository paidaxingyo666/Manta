/**
 * Built-ins Hermes does not ship must not reach mobile source.
 *
 * `hosts.toSorted(...)` passed typecheck, passed 3769 unit tests, and shipped —
 * then crashed the app on launch with `undefined is not a function`, because the
 * home screen's data hook evaluates it on first render. Nothing local can catch
 * this: TypeScript's lib has the method, the tests run on Node, and the suite
 * mocks react-native wholesale. React Native polyfills syntax, not built-ins.
 *
 * Every entry here is a method whose absence is a runtime TypeError rather than
 * a build failure, so the copy-free spread form is the only safe spelling.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MOBILE_ROOT = resolve(import.meta.dirname, '..')
const ROOTS = [join(MOBILE_ROOT, 'src'), join(MOBILE_ROOT, 'app')]
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

/** Method name → the spelling to use instead. */
const UNSUPPORTED: Record<string, string> = {
  toSorted: '[...x].sort(…)',
  toReversed: '[...x].reverse()',
  toSpliced: '[...x].splice(…) on a copy',
  groupBy: 'a plain reduce',
  withResolvers: 'new Promise((resolve, reject) => …)'
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue
    }
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path))
    } else if (SOURCE_EXTENSIONS.has(extname(entry)) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(path)
    }
  }
  return out
}

describe('Hermes built-in support', () => {
  it('never calls a method Hermes may not have', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, 'utf8')
        for (const [method, instead] of Object.entries(UNSUPPORTED)) {
          const call = new RegExp(`\\.${method}\\s*\\(`)
          if (call.test(source)) {
            offenders.push(`${relative(MOBILE_ROOT, file)}: .${method}() — use ${instead}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
