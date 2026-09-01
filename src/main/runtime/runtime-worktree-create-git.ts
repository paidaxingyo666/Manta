import type { BranchPrefixStrategy } from '../../shared/ui-chrome-types'
import type { Repo } from '../../shared/repo-types'
import { resolveWorktreeAddBaseRef } from '../../shared/worktree/base-ref'
import { getPRForBranch } from '../github/client'
import { hasCommitObjectViaGitExec } from '../git/commit-object-ref'
import { gitExecFileAsync } from '../git/runner'
import { hasWorktreeBaseCommitRef } from '../git/worktree-base-ref-probe'
import { listWorktrees } from '../git/worktree'
import { computeValidatedBranchName } from '../ipc/worktree-logic'
import { getHostedReviewForBranch } from '../source-control/hosted-review'
import {
  getSelectedReviewBranch,
  getSelectedReviewLookupHints,
  type SelectedReviewBranchInput
} from './selected-review-branch'
import { hasLocalGitOptions, normalizeLocalBranchName } from './runtime-worktree-selection'
import type { HostedReviewExecutionOptions } from '../source-control/hosted-review-git-options'

export async function resolveCreateBranchName(
  repoPath: string,
  branchNameOverride: string | undefined,
  sanitizedName: string,
  settings: { branchPrefix: string; branchPrefixCustom?: string },
  username: string | null,
  gitOptions: { wslDistro?: string } = {}
): Promise<string> {
  if (!branchNameOverride) {
    return computeValidatedBranchName(
      sanitizedName,
      { ...settings, branchPrefix: settings.branchPrefix as BranchPrefixStrategy },
      username
    )
  }
  if (branchNameOverride.startsWith('-')) {
    throw new Error('Branch name must not start with "-"')
  }
  await gitExecFileAsync(['check-ref-format', '--branch', branchNameOverride], {
    cwd: repoPath,
    ...gitOptions
  })
  return branchNameOverride
}

export async function canCheckoutExistingLocalBranch(
  repoPath: string,
  branchName: string,
  baseBranch: string,
  gitOptions: { wslDistro?: string } = {}
): Promise<boolean> {
  let localHead = ''
  try {
    const { stdout } = await gitExecFileAsync(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}^{commit}`],
      { cwd: repoPath, ...gitOptions }
    )
    localHead = stdout.trim()
  } catch {
    return false
  }
  if (normalizeLocalBranchName(baseBranch) !== branchName) {
    if (!localHead) {
      return false
    }
    try {
      const { stdout } = await gitExecFileAsync(
        ['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`],
        { cwd: repoPath, ...gitOptions }
      )
      if (stdout.trim() !== localHead) {
        return false
      }
    } catch {
      return false
    }
  }
  const worktrees = await listWorktrees(repoPath, gitOptions)
  return !worktrees.some((worktree) => normalizeLocalBranchName(worktree.branch) === branchName)
}

export function getLocalGitHubPrForBranch(
  repoPath: string,
  branchName: string,
  gitOptions: { wslDistro?: string }
): ReturnType<typeof getPRForBranch> {
  return hasLocalGitOptions(gitOptions)
    ? getPRForBranch(repoPath, branchName, null, null, null, {
        localGitExecOptions: gitOptions
      })
    : getPRForBranch(repoPath, branchName)
}

export async function getSelectedHostedReviewForBranch(
  repo: Pick<Repo, 'path' | 'connectionId'>,
  branchName: string,
  args: SelectedReviewBranchInput,
  executionOptions: HostedReviewExecutionOptions = {}
): Promise<{ matchesSelected: boolean; number: number } | null> {
  const selectedReview = getSelectedReviewBranch(args)
  if (!selectedReview) {
    return null
  }
  const review = await getHostedReviewForBranch({
    repoPath: repo.path,
    connectionId: repo.connectionId ?? null,
    branch: branchName,
    ...executionOptions,
    ...getSelectedReviewLookupHints(args)
  })
  return review
    ? {
        matchesSelected:
          review.provider === selectedReview.provider && review.number === selectedReview.number,
        number: review.number
      }
    : null
}

export async function hasLocalWorktreeBaseRef(
  repoPath: string,
  baseRef: string,
  options: { wslDistro?: string } = {}
): Promise<boolean> {
  const refExists = (qualifiedRef: string) =>
    hasWorktreeBaseCommitRef(repoPath, qualifiedRef, options)
  const resolvedBaseRef = await resolveWorktreeAddBaseRef(baseRef, refExists)
  if (resolvedBaseRef !== baseRef) {
    return true
  }
  if (baseRef.startsWith('refs/')) {
    return refExists(baseRef)
  }
  return hasCommitObjectViaGitExec(
    (gitArgs) => gitExecFileAsync(gitArgs, { cwd: repoPath, ...options }),
    baseRef
  )
}
