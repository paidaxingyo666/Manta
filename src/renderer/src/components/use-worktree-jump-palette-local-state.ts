import { useDeferredValue, useRef, useState } from 'react'
import type { WorktreePaletteRequestGuard } from '@/lib/worktree-palette-create-action'
import { EMPTY_PALETTE_FILTER, type PaletteFilterState } from '@/components/cmd-j/palette-filter'
import type { CmdJActiveGroupSnapshot } from '@/components/cmd-j/quick-action-context'
import type { WorkspaceVisibleTabType } from '../../../shared/tab-types'
import type { PaletteItem } from './worktree-jump-palette-model'

export function useWorktreeJumpPaletteLocalState({
  createLookupGuard
}: {
  createLookupGuard: WorktreePaletteRequestGuard
}) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [selectedItemId, setSelectedItemId] = useState('')
  const latestQueryRef = useRef('')
  const autoSelectedItemIdRef = useRef<string | null>(null)
  const digitShortcutItemsRef = useRef<readonly PaletteItem[]>([])
  const [rawFilter, setRawFilter] = useState<PaletteFilterState>(EMPTY_PALETTE_FILTER)
  const [dialogElement, setDialogElement] = useState<HTMLElement | null>(null)
  const previousWorktreeIdRef = useRef<string | null>(null)
  const previousActiveTabTypeRef = useRef<WorkspaceVisibleTabType>('terminal')
  const previousBrowserPageIdRef = useRef<string | null>(null)
  const previousBrowserFocusTargetRef = useRef<'webview' | 'address-bar'>('webview')
  const previousFocusElementRef = useRef<HTMLElement | null>(null)
  const activeGroupSnapshotRef = useRef<CmdJActiveGroupSnapshot | null>(null)
  const wasVisibleRef = useRef(false)
  const skipRestoreFocusRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fallbackFocusOuterFrameRef = useRef<number | null>(null)
  const fallbackFocusInnerFrameRef = useRef<number | null>(null)
  const preserveCreateLookupOnCloseRef = useRef(false)

  return {
    query,
    setQuery,
    deferredQuery,
    selectedItemId,
    setSelectedItemId,
    latestQueryRef,
    autoSelectedItemIdRef,
    digitShortcutItemsRef,
    rawFilter,
    setRawFilter,
    dialogElement,
    setDialogElement,
    previousWorktreeIdRef,
    previousActiveTabTypeRef,
    previousBrowserPageIdRef,
    previousBrowserFocusTargetRef,
    previousFocusElementRef,
    activeGroupSnapshotRef,
    wasVisibleRef,
    skipRestoreFocusRef,
    listRef,
    inputRef,
    fallbackFocusOuterFrameRef,
    fallbackFocusInnerFrameRef,
    createLookupGuard,
    preserveCreateLookupOnCloseRef
  }
}

export type WorktreeJumpPaletteLocalState = ReturnType<typeof useWorktreeJumpPaletteLocalState>
