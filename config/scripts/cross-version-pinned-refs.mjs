import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/

export function extractCrossVersionPinnedRefs(sources) {
  const tags = new Set()
  const commits = new Set()
  for (const source of sources) {
    for (const match of source.matchAll(/^const [A-Z0-9_]+_REF = '([^']+)'/gm)) {
      const ref = match[1]
      if (RELEASE_TAG.test(ref)) {
        tags.add(ref)
      } else if (/^[0-9a-f]{40}$/.test(ref)) {
        commits.add(ref)
      }
    }
    // A parameterized case pins its releases inline: `test.each(['v1.4.205', 'v1.4.211'])`.
    for (const list of source.matchAll(/\.each\(\[([^\]]*)\]/g)) {
      for (const literal of list[1].matchAll(/'([^']+)'/g)) {
        if (RELEASE_TAG.test(literal[1])) {
          tags.add(literal[1])
        }
      }
    }
  }
  return { tags: [...tags].sort(), commits: [...commits].sort() }
}

export function readCrossVersionPinnedRefs(repoRoot) {
  const directory = join(repoRoot, 'tests', 'e2e', 'cross-version-wire')
  const sources = readdirSync(directory)
    .filter((name) => name.endsWith('.unit.test.ts'))
    .map((name) => readFileSync(join(directory, name), 'utf8'))
  return extractCrossVersionPinnedRefs(sources)
}
