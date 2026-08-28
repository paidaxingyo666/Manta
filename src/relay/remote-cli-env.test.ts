import { describe, expect, it } from 'vitest'
import { pickRemoteCliEnv } from './remote-cli-env'

describe('pickRemoteCliEnv', () => {
  it('forwards SSH Manta terminal and worktree context for remote CLI calls', () => {
    expect(
      pickRemoteCliEnv({
        MANTA_TERMINAL_HANDLE: 'term_ssh',
        MANTA_WORKTREE_ID: 'repo::remote',
        MANTA_PANE_KEY: 'pane-1',
        MANTA_AGENT_LAUNCH_TOKEN: 'launch-secret',
        MANTA_WORKSPACE_ID: 'workspace-1',
        MANTA_USER_DATA_PATH: '/tmp/manta',
        PATH: '/usr/bin',
        SECRET_TOKEN: 'nope'
      })
    ).toEqual({
      MANTA_TERMINAL_HANDLE: 'term_ssh',
      MANTA_WORKTREE_ID: 'repo::remote',
      MANTA_PANE_KEY: 'pane-1',
      MANTA_AGENT_LAUNCH_TOKEN: 'launch-secret',
      MANTA_WORKSPACE_ID: 'workspace-1',
      MANTA_USER_DATA_PATH: '/tmp/manta',
      PATH: '/usr/bin'
    })
  })
})
