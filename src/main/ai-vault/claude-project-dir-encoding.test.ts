import { describe, expect, it } from 'vitest'
import {
  encodeClaudeProjectPath,
  encodeClaudeProjectPaths,
  isClaudeProjectDirInScope
} from './claude-project-dir-encoding'

describe('encodeClaudeProjectPath', () => {
  it('emits one dash per non-alphanumeric character rather than per run', () => {
    // The distinction is the whole contract: collapsing runs stops matching real bucket names.
    expect(encodeClaudeProjectPath('/Users/ada/manta/workspaces')).toBe(
      '-Users-ada-manta-workspaces'
    )
    expect(encodeClaudeProjectPath('/Users/ada/.manta/worktrees')).toBe(
      '-Users-ada--manta-worktrees'
    )
  })

  it('encodes a Windows drive path', () => {
    expect(encodeClaudeProjectPath('C:\\Users\\ada\\manta\\workspaces')).toBe(
      'C--Users-ada-manta-workspaces'
    )
    expect(encodeClaudeProjectPath('C:\\')).toBe('C--')
  })

  it('encodes a WSL UNC path', () => {
    expect(encodeClaudeProjectPath('\\\\wsl$\\Ubuntu\\home\\ada\\manta\\workspaces')).toBe(
      '--wsl--Ubuntu-home-ada-manta-workspaces'
    )
  })

  it('drops trailing separators but keeps a bare root', () => {
    expect(encodeClaudeProjectPath('/Users/ada/manta/')).toBe('-Users-ada-manta')
    expect(encodeClaudeProjectPath('/')).toBe('-')
  })

  it('offers the NFC spelling alongside the raw one', () => {
    const nfd = '/Users/ada/cafe\u0301'
    expect(encodeClaudeProjectPaths(nfd)).toEqual([
      encodeClaudeProjectPath(nfd),
      encodeClaudeProjectPath(nfd.normalize('NFC'))
    ])
    expect(encodeClaudeProjectPaths('/Users/ada/cafe')).toEqual(['-Users-ada-cafe'])
  })
})

describe('isClaudeProjectDirInScope', () => {
  it('accepts the prefix itself and its dash-delimited descendants', () => {
    expect(isClaudeProjectDirInScope('-w-manta', ['-w-manta'])).toBe(true)
    expect(isClaudeProjectDirInScope('-w-manta-nautilus', ['-w-manta'])).toBe(true)
  })

  it('rejects a sibling that merely starts with the prefix', () => {
    // Without the boundary, "manta" would absorb every workspace under "mantadyne".
    expect(isClaudeProjectDirInScope('-w-mantadyne-nautilus', ['-w-manta'])).toBe(false)
  })
})
