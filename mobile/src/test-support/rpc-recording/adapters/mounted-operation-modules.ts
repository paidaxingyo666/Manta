import { diffReviewMountAdapters } from './diff-review-mount-adapters'
import { fileInventoryMountAdapters } from './file-inventory-mount-adapters'
import { fileRequestMountAdapters } from './file-request-mount-adapters'
import { githubPrMountAdapters } from './github-pr-mount-adapters'
import { hostScreenMountAdapters } from './host-screen-mount-adapters'
import { hostWorktreeActionMountAdapters } from './host-worktree-action-mount-adapters'
import { hostedReviewMountAdapters } from './hosted-review-mount-adapters'
import { newTabAgentMountAdapters } from './new-tab-agent-mount-adapters'
import { newWorkspaceMountAdapters } from './new-workspace-mount-adapters'
import { settingsMountAdapters, settingsMountExposures } from './settings-mount-adapters'
import { sourceControlMountAdapters } from './source-control-mount-adapters'
import { taskMountAdapters } from './task-mount-adapters'
import { taskWorkspaceHookMountAdapters } from './task-workspace-hook-mount-adapters'
import { taskWorkspaceSenderMountAdapters } from './task-workspace-sender-mount-adapters'
import { workspaceSettingsMounts } from './workspace-settings-mounts'
import { worktreeCatalogMountAdapters } from './worktree-catalog-mount-adapters'
import type { MountedOperationModule } from '../mounted-operation-module'

/**
 * Every domain's mount adapters, paired with the file each one lives in. The register lives inside
 * the seam it registers, so adding a domain edits no engine file and moves no existing golden;
 * `adapter-seam.test.ts` checks each pairing names the file that declares it.
 */
export const MOUNTED_OPERATION_MODULES: readonly MountedOperationModule[] = [
  { source: 'diff-review-mount-adapters.ts', mounts: diffReviewMountAdapters },
  { source: 'file-inventory-mount-adapters.ts', mounts: fileInventoryMountAdapters },
  { source: 'file-request-mount-adapters.ts', mounts: fileRequestMountAdapters },
  { source: 'github-pr-mount-adapters.ts', mounts: githubPrMountAdapters },
  { source: 'host-screen-mount-adapters.ts', mounts: hostScreenMountAdapters },
  {
    source: 'host-worktree-action-mount-adapters.ts',
    mounts: hostWorktreeActionMountAdapters
  },
  { source: 'hosted-review-mount-adapters.ts', mounts: hostedReviewMountAdapters },
  { source: 'new-tab-agent-mount-adapters.ts', mounts: newTabAgentMountAdapters },
  { source: 'new-workspace-mount-adapters.ts', mounts: newWorkspaceMountAdapters },
  {
    source: 'settings-mount-adapters.ts',
    mounts: settingsMountAdapters,
    exposes: settingsMountExposures
  },
  { source: 'source-control-mount-adapters.ts', mounts: sourceControlMountAdapters },
  { source: 'task-mount-adapters.ts', mounts: taskMountAdapters },
  {
    source: 'task-workspace-hook-mount-adapters.ts',
    mounts: taskWorkspaceHookMountAdapters
  },
  {
    source: 'task-workspace-sender-mount-adapters.ts',
    mounts: taskWorkspaceSenderMountAdapters
  },
  { source: 'workspace-settings-mounts.ts', mounts: workspaceSettingsMounts },
  { source: 'worktree-catalog-mount-adapters.ts', mounts: worktreeCatalogMountAdapters }
]
