import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  aiVaultWorktreeCompactPath,
  aiVaultWorktreeJumpTooltip,
  canJumpToAiVaultSessionWorktree,
  isAiVaultSessionInCurrentWorktree,
  extractWorktreePathFromSessionTitle,
  resolveAiVaultSessionWorktreeDisplay,
  resolveAiVaultSessionWorktreeInfo,
  shouldShowAiVaultWorktreeStatusBadge,
  shouldShowAiVaultSessionWorktreeLine,
  type AiVaultSessionWorktreeInfo
} from './ai-vault-session-worktree'

const baseSession: AiVaultSession = {
  id: 'codex:session-1',
  executionHostId: 'local',
  agent: 'codex',
  sessionId: 'session-1',
  title: 'Find the pane',
  cwd: '/repo/manta/src',
  branch: null,
  model: null,
  filePath: '/home/ada/.codex/session-1.jsonl',
  codexHome: null,
  createdAt: null,
  updatedAt: '2026-06-24T10:00:00.000Z',
  modifiedAt: '2026-06-24T10:00:00.000Z',
  messageCount: 2,
  totalTokens: 42,
  previewMessages: [],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: "codex resume 'session-1'",
  subagent: null
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  const worktree: Worktree = {
    id: 'repo-1::/repo/manta',
    repoId: 'repo-1',
    displayName: 'manta',
    path: '/repo/manta',
    head: 'abc123',
    branch: 'main',
    isBare: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    isMainWorktree: false
  }
  return { ...worktree, ...overrides }
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo/manta',
    displayName: 'manta',
    badgeColor: '#737373',
    addedAt: 1,
    connectionId: null,
    executionHostId: 'local',
    ...overrides
  }
}

describe('resolveAiVaultSessionWorktreeInfo', () => {
  it('marks the selected owning worktree as current', () => {
    const worktree = makeWorktree()

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [worktree],
        activeWorktreeId: worktree.id
      })
    ).toMatchObject({
      status: 'current',
      label: 'manta',
      path: '/repo/manta'
    })
  })

  it('marks a known non-selected worktree as active', () => {
    const worktree = makeWorktree()

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [worktree],
        activeWorktreeId: 'other'
      })?.status
    ).toBe('active')
  })

  it('uses prior worktree paths to identify renamed active worktrees', () => {
    const worktree = makeWorktree({
      id: 'repo-1::/repo/manta-renamed',
      path: '/repo/manta-renamed',
      priorWorktreeIds: ['repo-1::/repo/manta']
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [worktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      status: 'active',
      label: 'manta',
      path: '/repo/manta'
    })
  })

  it('falls back to unavailable when no known worktree owns the transcript cwd', () => {
    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: baseSession,
        worktrees: [],
        activeWorktreeId: null
      })
    ).toMatchObject({
      status: 'unavailable',
      label: 'manta/src',
      path: '/repo/manta/src'
    })
  })

  it('matches WSL UNC worktree paths to Linux transcript cwd values', () => {
    const worktree = makeWorktree({
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\manta'
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: '/home/ada/manta/src' },
        worktrees: [worktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      status: 'active',
      label: 'manta',
      path: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\manta'
    })
  })

  it('uses the session host when multiple worktrees share the same path', () => {
    const localWorktree = makeWorktree({
      id: 'repo-local::/srv/manta',
      repoId: 'repo-local',
      displayName: 'local',
      path: '/srv/manta',
      hostId: 'local'
    })
    const sshWorktree = makeWorktree({
      id: 'repo-ssh::/srv/manta',
      repoId: 'repo-ssh',
      displayName: 'ssh',
      path: '/srv/manta',
      hostId: 'ssh:target-1'
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: '/srv/manta/src', executionHostId: 'ssh:target-1' },
        worktrees: [localWorktree, sshWorktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      label: 'ssh',
      worktreeId: sshWorktree.id
    })
  })

  it('uses repo host ownership when a legacy worktree lacks host metadata', () => {
    const worktree = makeWorktree({
      id: 'repo-ssh::/srv/manta',
      repoId: 'repo-ssh',
      displayName: 'ssh',
      path: '/srv/manta'
    })

    expect(
      resolveAiVaultSessionWorktreeInfo({
        session: { ...baseSession, cwd: '/srv/manta/src', executionHostId: 'ssh:target-1' },
        repos: [makeRepo({ id: 'repo-ssh', connectionId: 'target-1', executionHostId: null })],
        worktrees: [worktree],
        activeWorktreeId: null
      })
    ).toMatchObject({
      label: 'ssh',
      worktreeId: worktree.id
    })
  })
})

describe('canJumpToAiVaultSessionWorktree', () => {
  it('allows current and active worktree targets', () => {
    expect(canJumpToAiVaultSessionWorktree(makeWorktreeInfo('current'))).toBe(true)
    expect(canJumpToAiVaultSessionWorktree(makeWorktreeInfo('active'))).toBe(true)
  })

  it('disables jump targets that are not active worktrees', () => {
    expect(canJumpToAiVaultSessionWorktree(makeWorktreeInfo('archived'))).toBe(false)
    expect(canJumpToAiVaultSessionWorktree(makeWorktreeInfo('unavailable'))).toBe(false)
    expect(canJumpToAiVaultSessionWorktree(null)).toBe(false)
  })
})

describe('isAiVaultSessionInCurrentWorktree', () => {
  it('flags only the worktree the user is already viewing', () => {
    expect(isAiVaultSessionInCurrentWorktree(makeWorktreeInfo('current'))).toBe(true)
    expect(isAiVaultSessionInCurrentWorktree(makeWorktreeInfo('active'))).toBe(false)
    expect(isAiVaultSessionInCurrentWorktree(makeWorktreeInfo('archived'))).toBe(false)
    expect(isAiVaultSessionInCurrentWorktree(makeWorktreeInfo('unavailable'))).toBe(false)
    expect(isAiVaultSessionInCurrentWorktree(null)).toBe(false)
  })
})

describe('extractWorktreePathFromSessionTitle', () => {
  it('reads worktree paths embedded in session titles', () => {
    expect(
      extractWorktreePathFromSessionTitle(
        'Inspect PR #6229 - Worktree: /Users/ada/projects/manta/fix-tabs'
      )
    ).toBe('/Users/ada/projects/manta/fix-tabs')
    expect(extractWorktreePathFromSessionTitle('Worktree: /tmp/manta-worker')).toBe(
      '/tmp/manta-worker'
    )
  })
})

describe('resolveAiVaultSessionWorktreeDisplay', () => {
  it('falls back to title and branch when cwd is missing', () => {
    expect(
      resolveAiVaultSessionWorktreeDisplay({
        session: {
          ...baseSession,
          cwd: null,
          branch: null,
          title: 'Fix tabs - Worktree: /Users/ada/projects/manta/fix-tabs'
        },
        worktrees: [makeWorktree()],
        activeWorktreeId: null
      })?.path
    ).toBe('/Users/ada/projects/manta/fix-tabs')

    expect(
      resolveAiVaultSessionWorktreeDisplay({
        session: { ...baseSession, cwd: null, branch: 'chinese-translation-improvement' },
        worktrees: [makeWorktree()],
        activeWorktreeId: null
      })?.label
    ).toBe('chinese-translation-improvement')
  })
})

describe('aiVaultWorktreeCompactPath', () => {
  it('keeps the last two path segments for dense detail rows', () => {
    expect(aiVaultWorktreeCompactPath('/Users/ada/projects/manta/improve-agent-session')).toBe(
      'manta/improve-agent-session'
    )
  })
})

describe('shouldShowAiVaultSessionWorktreeLine', () => {
  it('hides the worktree row for the current worktree in workspace scope', () => {
    expect(
      shouldShowAiVaultSessionWorktreeLine(makeWorktreeInfo('current'), { vaultScope: 'workspace' })
    ).toBe(false)
    expect(
      shouldShowAiVaultSessionWorktreeLine(makeWorktreeInfo('current'), { vaultScope: 'all' })
    ).toBe(true)
    expect(
      shouldShowAiVaultSessionWorktreeLine(makeWorktreeInfo('active'), { vaultScope: 'workspace' })
    ).toBe(true)
    expect(shouldShowAiVaultSessionWorktreeLine(null, { vaultScope: 'workspace' })).toBe(false)
  })
})

describe('shouldShowAiVaultWorktreeStatusBadge', () => {
  it('hides the generic active badge but keeps meaningful states', () => {
    expect(shouldShowAiVaultWorktreeStatusBadge('active')).toBe(false)
    expect(shouldShowAiVaultWorktreeStatusBadge('current')).toBe(true)
    expect(shouldShowAiVaultWorktreeStatusBadge('archived')).toBe(true)
    expect(shouldShowAiVaultWorktreeStatusBadge('unavailable')).toBe(true)
  })

  it('hides the current badge in workspace scope', () => {
    expect(shouldShowAiVaultWorktreeStatusBadge('current', { vaultScope: 'workspace' })).toBe(false)
    expect(shouldShowAiVaultWorktreeStatusBadge('current', { vaultScope: 'all' })).toBe(true)
    expect(shouldShowAiVaultWorktreeStatusBadge('archived', { vaultScope: 'workspace' })).toBe(true)
  })
})

describe('aiVaultWorktreeJumpTooltip', () => {
  it('explains active jump targets and disabled states', () => {
    expect(aiVaultWorktreeJumpTooltip(makeWorktreeInfo('active'))).toBe('Jump to Worktree')
    expect(aiVaultWorktreeJumpTooltip(makeWorktreeInfo('archived'))).toBe(
      'This session is in an archived worktree.'
    )
    expect(aiVaultWorktreeJumpTooltip(makeWorktreeInfo('unavailable'))).toBe(
      'No active worktree matches this session.'
    )
    expect(aiVaultWorktreeJumpTooltip(null)).toBe('No worktree was recorded for this session.')
  })
})

function makeWorktreeInfo(
  status: AiVaultSessionWorktreeInfo['status']
): AiVaultSessionWorktreeInfo {
  return {
    status,
    label: 'manta',
    path: '/repo/manta',
    ...(status === 'unavailable' ? {} : { worktreeId: 'repo-1::/repo/manta' })
  }
}
