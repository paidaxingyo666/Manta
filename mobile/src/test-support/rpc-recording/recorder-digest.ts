import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'

export const RECORDER_DIRECTORY = 'mobile/src/test-support/rpc-recording'
const digests = new Map<string, string>()

function collect(root: string, relative: string, files: string[]): void {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1
  )) {
    const child = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      collect(root, child, files)
    } else if (!entry.name.endsWith('.md')) {
      files.push(child)
    }
  }
}

/**
 * Every executable recorder input, so a golden is attributable to one runner. Prose is excluded
 * because it cannot change a recording; a candidate run recomputes this and `compareGolden` fails
 * the header, which forces a recorder edit to re-record deliberately.
 *
 * The scenario manifest is deliberately not an input. It used to be, which made every golden's
 * header a function of every other family's scenarios: adding one family re-digested all 153 files
 * and put a conflict on that line in every domain branch. `scenarioSha256` pins each golden to the
 * scenarios it was actually recorded from instead.
 */
export function recorderSha256(root: string): string {
  const cached = digests.get(root)
  if (cached !== undefined) {
    return cached
  }
  const files: string[] = []
  collect(root, RECORDER_DIRECTORY, files)
  const digest = createHash('sha256')
    .update(
      files
        .map((file) => `${file}:${readFileSync(join(root, ...file.split(posix.sep)))}`)
        .join('\n')
    )
    .digest('hex')
  digests.set(root, digest)
  return digest
}
