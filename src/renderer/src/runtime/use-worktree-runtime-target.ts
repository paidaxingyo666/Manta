import { useAppStore } from '@/store'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { runtimeTargetForExecutionHostId, type RuntimeClientTarget } from './runtime-client-target'

/**
 * Runtime target that owns `worktreeId`, which is not always the globally
 * focused runtime — acting on the focused one scans the wrong host and reports
 * that workspace as having no ports. Direct-SSH owners return null.
 */
export function useWorktreeRuntimeTarget(
  worktreeId: string | null | undefined
): RuntimeClientTarget | null {
  return useAppStore((state) =>
    runtimeTargetForExecutionHostId(getExecutionHostIdForWorktree(state, worktreeId))
  )
}
