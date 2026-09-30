import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import {
  getComposerEligibleRepos,
  resolveComposerActiveRepoId,
  resolveComposerRepoId
} from './new-workspace-composer-repo'

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 0,
    ...overrides
  }
}

describe('new-workspace-composer-repo', () => {
  it('falls back to the first eligible repo when the focused host has no repos', () => {
    const eligibleRepos = [makeRepo('local-repo')]

    expect(resolveComposerRepoId({ eligibleRepos, focusedHostScope: 'ssh:gone' })).toBe(
      'local-repo'
    )
  })

  describe('resolveComposerActiveRepoId', () => {
    const localManta = makeRepo('local-manta', { upstream: { owner: 'stablyai', repo: 'manta' } })
    const runtimeManta = makeRepo('runtime-manta', {
      connectionId: 'runtime-ssh-manta-1',
      upstream: { owner: 'stablyai', repo: 'manta' }
    })
    const otherProject = makeRepo('noqa', { upstream: { owner: 'stablyai', repo: 'noqa' } })
    const repos = [otherProject, localManta, runtimeManta]
    const eligibleRepos = getComposerEligibleRepos(repos)

    it('maps an active runtime-owned SSH repo to its local same-project sibling', () => {
      expect(resolveComposerActiveRepoId(repos, eligibleRepos, 'runtime-manta')).toBe('local-manta')
    })

    it('leaves a normal active repo unchanged', () => {
      expect(resolveComposerActiveRepoId(repos, eligibleRepos, 'local-manta')).toBe('local-manta')
    })

    it('keeps the runtime repo id when no same-project sibling is eligible', () => {
      const onlyRuntime = [runtimeManta]
      expect(
        resolveComposerActiveRepoId(
          onlyRuntime,
          getComposerEligibleRepos(onlyRuntime),
          'runtime-manta'
        )
      ).toBe('runtime-manta')
    })

    it('passes through null/undefined active repo', () => {
      expect(resolveComposerActiveRepoId(repos, eligibleRepos, null)).toBeNull()
    })
  })
})
