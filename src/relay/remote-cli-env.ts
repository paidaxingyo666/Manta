export function pickRemoteCliEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const key of [
    'MANTA_TERMINAL_HANDLE',
    'MANTA_WORKTREE_ID',
    'MANTA_PANE_KEY',
    'MANTA_AGENT_LAUNCH_TOKEN',
    'MANTA_WORKSPACE_ID',
    'MANTA_USER_DATA_PATH',
    'PATH',
    'Path'
  ]) {
    const value = env[key]
    if (typeof value === 'string') {
      picked[key] = value
    }
  }
  return picked
}
