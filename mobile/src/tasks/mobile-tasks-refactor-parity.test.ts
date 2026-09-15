import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  readFlattenedMobileTasksHookSignatures,
  readMobileTasksSemanticSource,
  readMobileTasksStyleSource
} from './mobile-tasks-source-family.test-support'
import { readFlattenedMobileTasksRenderTokens } from './mobile-tasks-render-parity.test-support'
import {
  readFlattenedMobileTasksCoreStatements,
  readMobileTasksDeclarationSignatures
} from './mobile-tasks-execution-parity.test-support'

const hash = (parts: string[] | string): string =>
  createHash('sha256')
    .update(Array.isArray(parts) ? parts.join('\n') : parts)
    .digest('hex')

// Bound workspace-creation requests change source signatures the same way bound settings requests
// did: the method string and the envelope read leave the screen and an operation name arrives. The
// behaviour they used to pin is pinned by the recordings in mobile/rpc-foundation/goldens instead,
// which did not move. Statement, declaration, render and style counts are unchanged; `semantics`
// loses exactly the 22 `rpc:` signatures and 22 method literals the migration deleted.
const WORKSPACE_RPC_SCREEN_HOOKS =
  'f2e86ad01f91a1e24a00a651ae36a7e2a773669fba128ccc7ae84788c07f6590'
const PRE_REFACTOR_DIFF_HOOKS = '93c7189b32bed8456cc51814fffa8ce80cf62011ef968a9d53ddec2b9686f58f'
const WORKSPACE_RPC_STATEMENTS = '16a5659e8ed611fb87d340eb2c7f3222eb98a6bb075a513d91d076708ab09d6e'
const MAIN_REBASED_DECLARATIONS = '985cf8f0e8d8bc0246268da30c5ce5c8e010eee05cba2e73c0dcdf9f94822737'
const WORKSPACE_RPC_SEMANTICS = '127b2ea123ecdf8510c8d40692de4d4f12b547ac34f25c0c76d97e980dcb020e'
const PRE_REFACTOR_STYLES = '1db6af69c791d9963928541ad5310942fcbda6d984b422c90b6eb92b6816579a'
const PRE_REFACTOR_RENDER_TREE = '642f7d7b88d7d4c9793da2ac5efb37c7d4fb2ab979cf472c719549a8cfe76fc7'

describe('Mobile Tasks refactor parity', () => {
  it('preserves recursively flattened hook and dependency order', () => {
    const screenHooks = readFlattenedMobileTasksHookSignatures('MobileTasksScreen')
    expect(screenHooks).toHaveLength(350)
    expect(hash(screenHooks)).toBe(WORKSPACE_RPC_SCREEN_HOOKS)

    const diffHooks = readFlattenedMobileTasksHookSignatures('GitHubPrFileDiff')
    expect(diffHooks).toHaveLength(3)
    expect(hash(diffHooks)).toBe(PRE_REFACTOR_DIFF_HOOKS)
  })

  it('preserves every screen statement in execution order', () => {
    const statements = readFlattenedMobileTasksCoreStatements()
    expect(statements).toHaveLength(417)
    expect(hash(statements)).toBe(WORKSPACE_RPC_STATEMENTS)
  })

  it('preserves every moved top-level declaration', () => {
    const declarations = readMobileTasksDeclarationSignatures()
    expect(declarations).toHaveLength(194)
    expect(hash(declarations)).toBe(MAIN_REBASED_DECLARATIONS)
  })

  it('preserves RPC calls, runtime strings, and JSX host signatures', () => {
    const semantics = readMobileTasksSemanticSource()
    expect(semantics.split('\n')).toHaveLength(4_177)
    expect(hash(semantics)).toBe(WORKSPACE_RPC_SEMANTICS)
  })

  it('preserves render expressions and event handlers in tree order', () => {
    const tokens = readFlattenedMobileTasksRenderTokens()
    expect(tokens).toHaveLength(36_597)
    expect(hash(tokens)).toBe(PRE_REFACTOR_RENDER_TREE)
  })

  it('preserves every StyleSheet property and value', () => {
    expect(hash(readMobileTasksStyleSource())).toBe(PRE_REFACTOR_STYLES)
  })
})
