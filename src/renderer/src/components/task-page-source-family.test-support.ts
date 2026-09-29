import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TASK_PAGE_FLAT_SOURCE_PATTERN = /^(?:use-task-page-.*\.ts|task-page-.*\.tsx?)$/
const TASK_PAGE_DIRECTORY = 'task-page'
function isSourceFile(name: string): boolean {
  return !name.includes('.test.') && !name.includes('.test-support.')
}

// Why: the components/task-page tree nests by provider, so a flat readdir would silently
// return an empty family and turn every ratchet built on it into a no-op.
function readTaskPageDirectory(relativeDirectory: string): string[] {
  return readdirSync(join(__dirname, relativeDirectory), { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`
      if (entry.isDirectory()) {
        return readTaskPageDirectory(relativePath)
      }
      return /\.tsx?$/.test(entry.name) && isSourceFile(entry.name) ? [relativePath] : []
    }
  )
}

export const TASK_PAGE_SOURCE_FILES = [
  ...readdirSync(__dirname).filter(
    (name) => TASK_PAGE_FLAT_SOURCE_PATTERN.test(name) && isSourceFile(name)
  ),
  ...readTaskPageDirectory(TASK_PAGE_DIRECTORY)
].sort()

export function readTaskPageSource(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf8')
}

export function readTaskPageSourceFamily(): string {
  return TASK_PAGE_SOURCE_FILES.map(
    (relativePath) => `// TaskPage source: ${relativePath}\n${readTaskPageSource(relativePath)}`
  ).join('\n')
}
