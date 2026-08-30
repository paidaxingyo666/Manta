import { stat } from 'node:fs/promises'
import { isWorktreeCreatePreparation } from '../../shared/worktree/create-preparation'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { readTranslatedWorktreeGraph, readWorktreeList } from './worktree-list-reader'
import type { GitWorktreeExecOptions } from './worktree-operation-options'
import { getErrorCode, isNotGitRepositoryError } from './worktree-operation-options'
import { translateWorktreePath } from './worktree-path-comparison'
import { detectSparseCheckout } from './worktree-sparse-state'

const SPARSE_CHECKOUT_DETECTION_CONCURRENCY = 8

export async function listWorktreeGraph(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  try {
    const worktrees = await readTranslatedWorktreeGraph(repoPath, options)
    return options.includeCreatePreparations
      ? worktrees
      : worktrees.filter((worktree) => !isWorktreeCreatePreparation(worktree))
  } catch (err) {
    if (getErrorCode(err) === 'ENOENT') {
      try {
        await stat(repoPath)
      } catch (statErr) {
        if (getErrorCode(statErr) === 'ENOENT') {
          console.warn(`[git/worktree] repo path missing; skipping worktree list: ${repoPath}`)
          return []
        }
      }
    }
    if (isNotGitRepositoryError(err)) {
      return []
    }
    console.warn(`[git/worktree] listWorktreeGraph failed for ${repoPath}:`, err)
    return []
  }
}

export async function listWorktreesUnshared(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  try {
    const worktrees = await readTranslatedWorktreeGraph(repoPath, options)
    const visibleWorktrees = options.includeCreatePreparations
      ? worktrees
      : worktrees.filter((worktree) => !isWorktreeCreatePreparation(worktree))
    return annotateSparseCheckoutStatus(visibleWorktrees)
  } catch (err) {
    if (getErrorCode(err) === 'ENOENT') {
      try {
        await stat(repoPath)
      } catch (statErr) {
        if (getErrorCode(statErr) === 'ENOENT') {
          console.warn(`[git/worktree] repo path missing; skipping worktree list: ${repoPath}`)
          return []
        }
      }
    }
    if (isNotGitRepositoryError(err)) {
      return []
    }
    // Why: don't swallow git-compat/repo-state failures — else they resurface as opaque "created but not found in listing" errors.
    console.warn(`[git/worktree] listWorktrees failed for ${repoPath}:`, err)
    return []
  }
}

export async function listWorktreesStrict(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  const worktrees = (await readWorktreeList(repoPath, options)).map((worktree) => {
    const translatedPath = translateWorktreePath(worktree.path, repoPath, options)
    return translatedPath === worktree.path ? worktree : { ...worktree, path: translatedPath }
  })
  const visibleWorktrees = options.includeCreatePreparations
    ? worktrees
    : worktrees.filter((worktree) => !isWorktreeCreatePreparation(worktree))
  return annotateSparseCheckoutStatus(visibleWorktrees)
}

async function annotateSparseCheckoutStatus(
  worktrees: GitWorktreeInfo[]
): Promise<GitWorktreeInfo[]> {
  const annotated = [...worktrees]
  let nextIndex = 0

  async function detectNext(): Promise<void> {
    while (nextIndex < worktrees.length) {
      const index = nextIndex
      nextIndex += 1
      const worktree = worktrees[index]
      if (!worktree || worktree.isBare || worktree.isSparse) {
        continue
      }
      const isSparse = await detectSparseCheckout(worktree.path)
      if (isSparse) {
        annotated[index] = { ...worktree, isSparse }
      }
    }
  }

  // Why: cap concurrency so status-poll refreshes don't fan out many sparse-checkout filesystem probes at once.
  const workerCount = Math.min(SPARSE_CHECKOUT_DETECTION_CONCURRENCY, worktrees.length)
  await Promise.all(Array.from({ length: workerCount }, () => detectNext()))
  return annotated
}
