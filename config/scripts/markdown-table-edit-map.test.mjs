import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

const require = createRequire(import.meta.url)
const resolvedRoot = path.dirname(require.resolve('micromark-extension-gfm-table'))
const root = path.basename(resolvedRoot) === 'dev' ? path.dirname(resolvedRoot) : resolvedRoot
for (const directory of ['lib', 'dev/lib']) {
  const { EditMap } = await import(pathToFileURL(path.join(root, directory, 'edit-map.js')).href)
  describe(`table edit map ${directory}`, () => {
    it('merges repeated offsets, sorts edits, and resets for reuse', () => {
      const edits = new EditMap()
      edits.add(3, 1, ['c'])
      edits.add(1, 1, ['a'])
      edits.add(3, 1, ['d'])
      edits.add(0, 0, [])
      const events = [0, 1, 2, 3, 4, 5]
      edits.consume(events)
      expect(events).toEqual([0, 'a', 2, 'c', 'd', 5])
      edits.add(1, 1, ['new'])
      edits.consume(events)
      expect(events).toEqual([0, 'new', 2, 'c', 'd', 5])
    })

    it('does not scan prior offsets when adding thousands of distinct edits', () => {
      const edits = new EditMap()
      edits.add(0, 1, ['first'])
      let reads = 0
      const first = edits.map[0]
      Object.defineProperty(edits.map, '0', {
        configurable: true,
        get() {
          reads += 1
          return first
        }
      })
      for (let offset = 1; offset < 5000; offset += 1) {
        edits.add(offset, 1, [offset])
      }
      expect(reads).toBe(0)
      expect(edits.map).toHaveLength(5000)
    })

    it('preserves complete parsed trees and source positions against the previous merge algorithm', () => {
      const parser = unified().use(remarkParse).use(remarkGfm)
      const sources = [
        '| a | b |\n| :- | -: |\n| x | y |\n',
        '> | a | b |\n> | --- | --- |\n> | **bold** | [link][r] |\n\n[r]: https://example.com',
        '- item\n\n  | a | b |\n  | --- | --- |\n  | x | y |',
        '| escaped \\| pipe | `code` |\n| --- | --- |\n| ~~del~~ | 😀 |\n',
        `Before\n\n${'| a | b |\n| --- | --- |\n| x | y |\n\n'.repeat(200)}`
      ]
      const patched = sources.map((source) => parser.parse(source))
      const originalAdd = EditMap.prototype.add
      let stockCalls = 0
      try {
        EditMap.prototype.add = function (at, remove, add) {
          stockCalls += 1
          if (remove === 0 && add.length === 0) {
            return
          }
          const change = this.map.find((entry) => entry[0] === at)
          if (change) {
            change[1] += remove
            change[2].push(...add)
          } else {
            this.map.push([at, remove, add])
          }
        }
        expect(sources.map((source) => parser.parse(source))).toEqual(patched)
        if (directory === 'dev/lib') {
          expect(stockCalls).toBeGreaterThan(0)
        }
      } finally {
        EditMap.prototype.add = originalAdd
      }
    })
  })
}
