import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/project-types'
import type { Repo } from '../../../shared/repo-types'
import { resolveProjectCloneUrlPrefill } from './project-clone-url-prefill'

function project(sourceRepoIds: string[]): Project {
  return { id: 'project-manta', sourceRepoIds } as unknown as Project
}

function repo(id: string, remoteUrl: string): Repo {
  return { id, gitRemoteIdentity: { remoteUrl } } as unknown as Repo
}

describe('resolveProjectCloneUrlPrefill', () => {
  it('strips an embedded token so it is never cloned onto another host', () => {
    // The clone runs on the target host and would persist this into .git/config.
    const prefill = resolveProjectCloneUrlPrefill(
      [project(['repo-1'])],
      [repo('repo-1', 'https://x-access-token:ghp_ABC123@github.com/acme/manta.git')],
      'project-manta'
    )

    expect(prefill).toBe('https://github.com/acme/manta.git')
    expect(prefill).not.toContain('ghp_ABC123')
  })

  it('strips a user:password pair on any scheme', () => {
    expect(
      resolveProjectCloneUrlPrefill(
        [project(['repo-1'])],
        [repo('repo-1', 'https://alice:hunter2@gitlab.com/acme/manta.git')],
        'project-manta'
      )
    ).toBe('https://gitlab.com/acme/manta.git')
  })

  it('leaves an SSH remote untouched, since git@host is part of the URL', () => {
    expect(
      resolveProjectCloneUrlPrefill(
        [project(['repo-1'])],
        [repo('repo-1', 'git@github.com:stablyai/manta.git')],
        'project-manta'
      )
    ).toBe('git@github.com:stablyai/manta.git')
  })

  it('returns empty when the project, repo, or remote is missing', () => {
    expect(resolveProjectCloneUrlPrefill([], [], null)).toBe('')
    expect(resolveProjectCloneUrlPrefill([], [], 'project-manta')).toBe('')
    expect(resolveProjectCloneUrlPrefill([project(['repo-1'])], [], 'project-manta')).toBe('')
  })

  it('takes the first source repo that actually has a remote', () => {
    expect(
      resolveProjectCloneUrlPrefill(
        [project(['repo-no-remote', 'repo-2'])],
        [
          { id: 'repo-no-remote' } as unknown as Repo,
          repo('repo-2', 'https://github.com/acme/second.git')
        ],
        'project-manta'
      )
    ).toBe('https://github.com/acme/second.git')
  })
})
