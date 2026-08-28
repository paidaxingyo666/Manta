import { describe, expect, it } from 'vitest'
import {
  extractGitHubIssueSourceError,
  extractGitHubIssueSourceFallback
} from './github-work-item-source-errors'

describe('extractGitHubIssueSourceError', () => {
  it('keeps the failing issue source slug with the repo that produced it', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/manta' },
        {
          sources: { issues: { owner: 'upstream', repo: 'manta' } },
          errors: { issues: { message: 'HTTP 403: resource not accessible' } }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/manta',
      source: { owner: 'upstream', repo: 'manta' },
      message: 'HTTP 403: resource not accessible'
    })
  })

  it('drops issue errors when the source slug is unavailable', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/manta' },
        {
          sources: { issues: null },
          errors: { issues: { message: 'failed' } }
        }
      )
    ).toBeNull()
  })

  it('returns null when the envelope has no issue-side error', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/manta' },
        {
          sources: { issues: { owner: 'stablyai', repo: 'manta' } }
        }
      )
    ).toBeNull()
  })
})

describe('extractGitHubIssueSourceFallback', () => {
  it('reports the repo whose upstream issue source fell back to origin', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/manta', displayName: 'manta' },
        {
          issueSourceFellBack: true,
          sources: {
            issues: { owner: 'stablyai', repo: 'manta-fork' },
            prs: { owner: 'stablyai', repo: 'manta' }
          }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/manta',
      repoLabel: 'stablyai/orca'
    })
  })

  it('uses the Manta repo display name when the PR source is unavailable', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/manta', displayName: 'manta' },
        {
          issueSourceFellBack: true,
          sources: { issues: null, prs: null }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/manta',
      repoLabel: 'manta'
    })
  })

  it('returns null when the source resolver did not fall back', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/manta', displayName: 'manta' },
        {
          sources: { issues: { owner: 'stablyai', repo: 'manta' } }
        }
      )
    ).toBeNull()
  })
})
