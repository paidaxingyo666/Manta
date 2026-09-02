// @ts-nocheck -- mechanically split from MantaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { MantaRuntimeWithRecordPtyWorktree } from './manta-runtime-record-pty-worktree'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'

export class MantaRuntimeWithRefreshPtyWorktreeRecordsFromController extends MantaRuntimeWithRecordPtyWorktree {
  /** Synchronizes PTY tracking records with running daemon sessions, querying their foreground agent states. */
  protected async refreshPtyWorktreeRecordsFromController(
    resolvedWorktrees: ResolvedWorktree[],
    targetWorktreeId: string | null = null,
    deadline?: number
  ): Promise<Set<string> | null> {
    const inventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
      resolvedWorktrees,
      targetWorktreeId,
      deadline
    )
    return inventory ? new Set(inventory.livePtyIds) : null
  }
}
