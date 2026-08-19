import type { FsChangedPayload } from '../../../shared/filesystem-entry-types'

export const MANTA_WORKTREE_FILE_CHANGE_EVENT = 'manta:worktree-file-change'

export type WorktreeFileChangeEventDetail = {
  payload: FsChangedPayload
  runtimeEnvironmentId: string | null
}
