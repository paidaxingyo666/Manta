import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { listWorktreesUnshared } from './worktree-listing'
import type { GitWorktreeExecOptions } from './worktree-operation-options'
import { WORKTREE_LIST_TIMEOUT_MS } from './worktree-operation-options'

// Why: share concurrent `git worktree list` scans, which are expensive on Windows.
const inFlightWorktreeScans = new Map<string, Promise<GitWorktreeInfo[]>>()

// Why: mutation generations prevent listings from joining stale scans.
const worktreeScanGenerations = new Map<string, number>()

function hasInFlightWorktreeScanForRepo(repoPath: string): boolean {
  const keyPrefix = `${repoPath}\0`
  for (const key of inFlightWorktreeScans.keys()) {
    if (key.startsWith(keyPrefix)) {
      return true
    }
  }
  return false
}

export function bumpWorktreeScanGeneration(repoPath: string): void {
  // Why: generations only prevent joining a pre-mutation scan; with no active scan, keeping the repo path just leaks completed mutation keys.
  if (!hasInFlightWorktreeScanForRepo(repoPath)) {
    return
  }
  worktreeScanGenerations.set(repoPath, (worktreeScanGenerations.get(repoPath) ?? 0) + 1)
}

function pruneWorktreeScanGeneration(repoPath: string): void {
  // Why: keep ordinary scan settlement O(1); only repos invalidated during an active scan need the cross-generation check.
  if (!worktreeScanGenerations.has(repoPath)) {
    return
  }
  if (!hasInFlightWorktreeScanForRepo(repoPath)) {
    worktreeScanGenerations.delete(repoPath)
  }
}

export function _getWorktreeScanCacheSizesForTests(): { inFlight: number; generations: number } {
  return {
    inFlight: inFlightWorktreeScans.size,
    generations: worktreeScanGenerations.size
  }
}

export function _resetWorktreeScanCacheForTests(): void {
  inFlightWorktreeScans.clear()
  worktreeScanGenerations.clear()
}

/**
 * List all worktrees for a git repo at the given path. Concurrent calls for
 * the same repo share one scan (unless the caller passes an AbortSignal,
 * which must only cancel its own scan).
 */
export function listWorktrees(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  if (options.signal) {
    return listWorktreesUnshared(repoPath, options)
  }
  const generation = worktreeScanGenerations.get(repoPath) ?? 0
  const timeout = options.timeout ?? WORKTREE_LIST_TIMEOUT_MS
  // Why: callers with different deadlines cannot safely share which timeout wins the scan.
  const key = `${repoPath}\0${options.wslDistro ?? ''}\0${timeout}\0${generation}`
  const inFlight = inFlightWorktreeScans.get(key)
  if (inFlight) {
    return inFlight
  }
  const scan = listWorktreesUnshared(repoPath, options).finally(() => {
    if (inFlightWorktreeScans.get(key) === scan) {
      inFlightWorktreeScans.delete(key)
    }
    pruneWorktreeScanGeneration(repoPath)
  })
  inFlightWorktreeScans.set(key, scan)
  return scan
}
