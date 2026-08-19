import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'
import { isWslUncPath } from '../../../shared/wsl-paths'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'

export type OrchestrationCliCommand = 'manta' | 'manta-ide'

export function resolveTerminalOrchestrationCliCommand(args: {
  connectionId: string | null
  isWsl: boolean | null | undefined
  worktreeId: string
  projectRuntime?: ProjectExecutionRuntimeResolution
}): OrchestrationCliCommand {
  if (args.connectionId) {
    return 'manta'
  }
  if (args.isWsl !== null && args.isWsl !== undefined) {
    return args.isWsl ? 'manta-ide' : 'manta'
  }
  if (args.projectRuntime?.status === 'resolved' && args.projectRuntime.runtime.kind === 'wsl') {
    return 'manta-ide'
  }

  const worktreePath = splitWorktreeIdForFilesystem(args.worktreeId)?.worktreePath
  return worktreePath && isWslUncPath(worktreePath) ? 'manta-ide' : 'manta'
}
