import { describe, expect, it } from 'vitest'
import { getLocalExecutionHostLabel } from '../../../src/shared/execution-host'
import {
  buildNewWorkspaceProjectOptions,
  buildNewWorkspaceRunTargetOptions,
  getNewWorkspaceRunTarget
} from './new-workspace-project-targets'

const LOCAL_HOST_LABEL = getLocalExecutionHostLabel('darwin')

describe('new workspace project targets', () => {
  it('groups local and SSH checkouts of the same project', () => {
    const upstream = { owner: 'stablyai', repo: 'manta' }
    const options = buildNewWorkspaceProjectOptions([
      { id: 'local', displayName: 'manta', path: '/src/manta', upstream },
      {
        id: 'ssh',
        displayName: 'manta',
        path: '/home/dev/manta',
        connectionId: 'build-server',
        upstream
      }
    ])

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ label: 'manta', detail: 'stablyai/manta' })
  })

  it('shows the provider slug recovered from canonical git identity', () => {
    const options = buildNewWorkspaceProjectOptions([
      {
        id: 'local',
        displayName: 'manta',
        path: '/src/manta',
        gitRemoteIdentity: {
          canonicalKey: 'github.com/stablyai/manta',
          remoteName: 'origin',
          remoteUrl: 'git@github.com:stablyai/manta.git'
        }
      }
    ])

    expect(options[0]).toMatchObject({ label: 'manta', detail: 'stablyai/manta' })
  })

  it('labels local, SSH, and paired runtime targets', () => {
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'manta', path: '/src/manta' }, 'darwin')
    ).toEqual({ label: LOCAL_HOST_LABEL, detail: '/src/manta' })
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'manta', path: 'C:\\src\\manta' })
    ).toEqual({ label: 'This computer', detail: 'C:\\src\\manta' })
    expect(
      getNewWorkspaceRunTarget(
        { id: 'local', displayName: 'manta', path: 'C:\\src\\manta' },
        'win32'
      )
    ).toEqual({ label: 'Local Windows', detail: 'C:\\src\\manta' })
    expect(
      getNewWorkspaceRunTarget({
        id: 'ssh',
        displayName: 'manta',
        path: 'C:\\src\\manta',
        executionHostId: 'ssh:Windows%20VM'
      })
    ).toEqual({ label: 'SSH · Windows VM', detail: 'C:\\src\\manta' })
    expect(
      getNewWorkspaceRunTarget({
        id: 'runtime',
        displayName: 'manta',
        path: '/src/manta',
        executionHostId: 'runtime:devbox'
      })
    ).toEqual({ label: 'Remote · devbox', detail: '/src/manta' })
  })

  it('shows one target per host when the project has multiple local worktrees', () => {
    const upstream = { owner: 'stablyai', repo: 'manta' }
    const repos = [
      { id: 'local-a', displayName: 'manta-a', path: '/src/manta-a', upstream },
      { id: 'local-b', displayName: 'manta-b', path: '/src/manta-b', upstream },
      {
        id: 'ssh',
        displayName: 'manta',
        path: '/home/dev/manta',
        connectionId: 'build-server',
        upstream
      }
    ]
    const projectId = buildNewWorkspaceProjectOptions(repos)[0]?.id ?? null

    expect(buildNewWorkspaceRunTargetOptions(repos, projectId, 'darwin')).toEqual([
      expect.objectContaining({ id: 'local-a', label: LOCAL_HOST_LABEL, detail: '/src/manta-a' }),
      expect.objectContaining({ id: 'ssh', label: 'SSH · build-server', detail: '/home/dev/manta' })
    ])
  })
})
