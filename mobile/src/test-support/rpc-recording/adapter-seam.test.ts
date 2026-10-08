import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { MOUNTED_OPERATION_MODULES } from './adapters/mounted-operation-modules'
import {
  HOST_CLIENT_CONTEXT_LOCAL,
  hostClientContextExposure
} from './host-client-context-exposure'
import { pilotMountAdapters } from './pilot-mount-adapters'
import { readScenarios } from './scenario-input'
import { runRecording } from './run-recording'
import { vitestRecordingScheduler } from './vitest-recording-scheduler'

const root = resolve(import.meta.dirname, '../../../..')
const manifest = readScenarios(
  process.env.RPC_FOUNDATION_SCENARIOS ??
    resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json')
).scenarios
const engine = resolve(import.meta.dirname)
const directory = join(engine, 'adapters')
/** The register is the seam's own index, not an adapter. */
const REGISTER = 'mounted-operation-modules.ts'
const sources = MOUNTED_OPERATION_MODULES.map((module) => module.source)

describe('the adapter directory', () => {
  // A module left out of the register mounts nothing, so its scenarios fail as unknown operations.
  it('registers every file in the adapter directory', () => {
    const present = readdirSync(directory).filter((file) => file !== REGISTER)
    expect(present.sort()).toEqual([...sources].sort())
  })

  it('keeps the host-client context exposure in one place, still anchored on the product source', () => {
    // The recorder's appended export must name the same context the provider imports.
    const [, source] = hostClientContextExposure
    const declaration = `export const ${HOST_CLIENT_CONTEXT_LOCAL} = createContext`
    const context = readFileSync(
      join(root, 'mobile/src/transport/rpc-client-context-contract.ts'),
      'utf8'
    )
    expect(context.split(declaration).length - 1).toBe(1)
    const provider = ts.createSourceFile(
      'client-context.tsx',
      readFileSync(join(root, 'mobile/src/transport/client-context.tsx'), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    const bindings = provider.statements.filter(ts.isImportDeclaration).flatMap((statement) => {
      const clause = statement.importClause?.namedBindings
      if (
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== './rpc-client-context-contract' ||
        !clause ||
        !ts.isNamedImports(clause)
      ) {
        return []
      }
      return clause.elements.map((element) => element.name.text)
    })
    expect(bindings.filter((binding) => binding === HOST_CLIENT_CONTEXT_LOCAL)).toHaveLength(1)
    // Sources only, since the README quotes the string to document it.
    const copies = [engine, directory]
      .flatMap((from) =>
        readdirSync(from, { withFileTypes: true })
          .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
          .map((entry) => join(from, entry.name))
      )
      .filter((file) => readFileSync(file, 'utf8').includes(source.trim()))
      .map((file) => relative(root, file))
      .sort()
    expect(copies).toEqual([])
  })

  it.each([
    ['aivault-history-scan-fulfilled', 'ready'],
    ['aivault-history-scan-unsupported', 'unsupported'],
    ['aivault-history-scan-worktrees-late', 'ready']
  ])('mounts %s through the fork context contract', async (id, kind) => {
    const scenario = manifest.find((candidate) => candidate.id === id)
    if (!scenario) {
      throw new Error(`No recording scenario named ${id}`)
    }
    const { adapters } = pilotMountAdapters(root, { device: scenario })
    const recording = await runRecording(
      scenario,
      adapters[scenario.operation]!,
      vitestRecordingScheduler()
    )
    expect(recording.checkpoints.at(-1)?.observation.state).toMatchObject({
      scope: 'workspace',
      screenState: { kind },
      refreshing: false
    })
  })
})
