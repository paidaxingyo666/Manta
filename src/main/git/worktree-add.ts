import { resolveWorktreeAddBaseRef } from '../../shared/worktree/base-ref'
import type {
  LocalBaseRefRefreshResult,
  LocalBaseRefUpdateSuggestion
} from '../../shared/worktree/base-ref-drift-types'
import { windowsLongPathGitArgs } from '../../shared/windows-long-path-git-args'
import { gitExecFileAsync } from './runner'
import { runWithGitReadCacheInvalidation } from './status'
import {
  getLocalBaseRefUpdateSuggestionForWorktreeCreate,
  refreshLocalBaseRefForWorktreeCreate
} from './worktree-base-refresh'
import { hasWorktreeBaseCommitRef } from './worktree-base-ref-probe'
import type {
  AddWorktreeOptions,
  AddWorktreeResult,
  GitWorktreeExecOptions
} from './worktree-operation-options'
import { gitExecOptions, resolveWorktreeAddTimeoutMs } from './worktree-operation-options'
import { bumpWorktreeScanGeneration } from './worktree-scan-cache'

async function persistWorktreeCreationBase(
  worktreePath: string,
  branch: string,
  effectiveBase: string,
  options: GitWorktreeExecOptions = {}
): Promise<void> {
  const configKey = `branch.${branch}.base`
  try {
    await gitExecFileAsync(['config', '--local', '--replace-all', configKey, effectiveBase], {
      ...gitExecOptions(worktreePath, options)
    })
  } catch (error) {
    console.warn(`addWorktree: failed to set ${configKey} for ${worktreePath}`, error)
    try {
      // Why: reused branch names may carry stale base metadata; if replacement fails, unset it so consumers don't trust stale lineage.
      await gitExecFileAsync(['config', '--local', '--unset-all', configKey], {
        ...gitExecOptions(worktreePath, options)
      })
    } catch (unsetError) {
      console.warn(
        `addWorktree: failed to unset stale ${configKey} for ${worktreePath}`,
        unsetError
      )
    }
  }
}

export async function unsetWorktreeCreationBase(
  worktreePath: string,
  branch: string,
  options: GitWorktreeExecOptions = {}
): Promise<void> {
  try {
    await gitExecFileAsync(['config', '--local', '--unset-all', `branch.${branch}.base`], {
      ...gitExecOptions(worktreePath, options)
    })
  } catch {
    // Best-effort cleanup; leave the original sparse-setup error as the actionable failure.
  }
}

/**
 * Create a new worktree.
 * @param repoPath - Path to the main repo (or bare repo)
 * @param worktreePath - Absolute path where the worktree will be created
 * @param branch - Branch name for the new worktree
 * @param baseBranch - Optional base branch to create from (defaults to HEAD)
 * @remarks Side effects (best-effort, warn-only): passes `--no-track`, writes
 * `branch.<branch>.base` for new-branch worktrees with a base ref, and may
 * write `push.autoSetupRemote=true` to the repo's shared config.
 */
export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  baseBranch?: string,
  refreshLocalBaseRef = false,
  noCheckout = false,
  options: AddWorktreeOptions = {}
): Promise<AddWorktreeResult> {
  try {
    return await runWithGitReadCacheInvalidation(() =>
      performAddWorktree(
        repoPath,
        worktreePath,
        branch,
        baseBranch,
        refreshLocalBaseRef,
        noCheckout,
        options
      )
    )
  } finally {
    bumpWorktreeScanGeneration(repoPath)
  }
}

async function performAddWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  baseBranch?: string,
  refreshLocalBaseRef = false,
  noCheckout = false,
  options: AddWorktreeOptions = {}
): Promise<AddWorktreeResult> {
  let localBaseRefRefresh: LocalBaseRefRefreshResult | undefined
  let localBaseRefUpdateSuggestion: LocalBaseRefUpdateSuggestion | undefined
  // Why: enable long paths for this Windows checkout without changing user Git config.
  const args = [...windowsLongPathGitArgs(repoPath), 'worktree', 'add']
  let effectiveBase: string | undefined
  if (noCheckout) {
    args.push('--no-checkout')
  }
  if (options.checkoutExistingBranch) {
    // Why: -b would create a new branch instead of checking out the selected one.
    args.push(worktreePath, branch)
  } else {
    // Why: --no-track avoids inheriting the base's upstream so `git status` won't misreport "behind by N" pre-publish; first push sets it (see push.autoSetupRemote below).
    args.push('--no-track', '-b', branch, worktreePath)
    if (baseBranch) {
      effectiveBase = await resolveWorktreeAddBaseRef(baseBranch, (qualifiedRef) =>
        hasWorktreeBaseCommitRef(repoPath, qualifiedRef, options)
      )
      // Why: resolve the creation base first to distinguish remote-tracking refs from slash-containing local branches (mutation gated behind the explicit setting).
      if (refreshLocalBaseRef) {
        localBaseRefRefresh = await refreshLocalBaseRefForWorktreeCreate(
          repoPath,
          baseBranch,
          effectiveBase,
          options.remoteTrackingBase,
          options
        )
      } else if (options.suggestLocalBaseRefUpdate) {
        localBaseRefUpdateSuggestion = await getLocalBaseRefUpdateSuggestionForWorktreeCreate(
          repoPath,
          baseBranch,
          effectiveBase,
          options.remoteTrackingBase,
          options
        )
      }
      args.push(effectiveBase)
    }
  }
  await gitExecFileAsync(args, {
    ...gitExecOptions(repoPath, options),
    // Why: resolve per call — hoisting this to a module const would freeze the override at import.
    timeout: resolveWorktreeAddTimeoutMs()
  })

  if (options.checkoutExistingBranch) {
    return localBaseRefRefresh ? { localBaseRefRefresh } : {}
  }

  if (effectiveBase) {
    await persistWorktreeCreationBase(worktreePath, branch, effectiveBase, options)
  }

  // SSH parity: relay's addWorktreeOp (src/relay/git-handler-worktree-ops.ts) mirrors this — change both in lockstep.
  // Why: --no-track leaves no upstream until first push; push.autoSetupRemote=true lets a plain
  // `git push` create+set origin/<branch> (git >=2.37; older clients ignore it). `--local` on a
  // linked worktree writes the shared common-dir config (whole repo) — intentional and idempotent,
  // so it's warn-only and not rolled back on failure.
  try {
    // Why: `--get` (not `--local --get`) so a value at any scope counts as "user already chose" and isn't overwritten.
    let alreadySet = false
    try {
      await gitExecFileAsync(['config', '--get', 'push.autoSetupRemote'], {
        ...gitExecOptions(worktreePath, options)
      })
      alreadySet = true
    } catch (readError) {
      // Why: `git config --get` exits 1 only when unset at every scope; any other code is a real read failure — rethrow rather than overwrite the user's value.
      const code = (readError as { code?: unknown })?.code
      if (code !== 1) {
        throw readError
      }
    }
    if (!alreadySet) {
      await gitExecFileAsync(['config', '--local', 'push.autoSetupRemote', 'true'], {
        ...gitExecOptions(worktreePath, options)
      })
    }
  } catch (error) {
    console.warn(`addWorktree: failed to set push.autoSetupRemote for ${worktreePath}`, error)
  }
  return {
    ...(localBaseRefRefresh ? { localBaseRefRefresh } : {}),
    ...(localBaseRefUpdateSuggestion ? { localBaseRefUpdateSuggestion } : {})
  }
}
