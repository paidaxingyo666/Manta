export const MANTA_EDITOR_SAVE_DIRTY_FILES_EVENT = 'manta:editor-save-dirty-files'
export const MANTA_EDITOR_PREPARE_HOT_EXIT_EVENT = 'manta:editor-prepare-hot-exit'

export type EditorSaveDirtyFilesDetail = {
  claim: () => void
  resolve: () => void
  reject: (message: string) => void
}

export type EditorPrepareHotExitDetail = EditorSaveDirtyFilesDetail
