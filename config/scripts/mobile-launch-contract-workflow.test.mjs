import { existsSync, readFileSync } from 'node:fs'
import { dirname, matchesGlob, relative, resolve, sep } from 'node:path'
import { expect, it } from 'vitest'
import ts from 'typescript-api'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflow = parse(readFileSync(resolve(projectDir, '.github/workflows/mobile.yml'), 'utf8'))
const classifyStep = workflow.jobs.changes.steps.find(
  (step) => step.name === 'Classify changed paths'
)
const pullRequestPattern = classifyStep.run.match(/grep -Eq '([^']+)' <<</)?.[1]
expect(pullRequestPattern, 'mobile PR classifier must remain inspectable').toBeDefined()
const pullRequestPaths = new RegExp(pullRequestPattern)

it.each(['agent-launch-mobile-replay', 'mobile-agent-launch-architecture'])(
  'runs Mobile Checks when a direct root dependency of %s changes',
  (name) => {
    const suite = resolve(projectDir, `mobile/src/tasks/${name}.test.ts`)
    // Parse source only: the root test project must never load the mobile dependency graph.
    const imports = ts
      .preProcessFile(readFileSync(suite, 'utf8'), true)
      .importedFiles.filter((entry) => entry.fileName.startsWith('.'))
      .map((entry) =>
        relative(projectDir, resolve(dirname(suite), `${entry.fileName}.ts`))
          .split(sep)
          .join('/')
      )
      .filter((file) => file.startsWith('src/'))

    expect(imports).not.toEqual([])
    for (const file of imports) {
      expect(existsSync(resolve(projectDir, file)), file).toBe(true)
      expect(
        workflow.on.push.paths.some((pattern) => matchesGlob(file, pattern)),
        file
      ).toBe(true)
      expect(pullRequestPaths.test(file), file).toBe(true)
    }
  }
)
