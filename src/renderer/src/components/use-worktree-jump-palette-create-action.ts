import { useCallback, useEffect, useLayoutEffect } from 'react'
import { parseGitHubIssueOrPRLink, parseGitHubIssueOrPRNumber } from '@/lib/github-links'
import {
  getLinkedWorkItemSuggestedName,
  getLinkedWorkItemWorkspaceName,
  type LinkedWorkItemSummary
} from '@/lib/new-workspace'
import { lookupGitHubWorkItemForSource } from '@/lib/github-work-item-source-lookup'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { queueWorkspaceActivationTerminalFocus } from '@/lib/workspace-activation-terminal-focus'
import { subscribeCmdJRowIndexJump } from '@/lib/cmd-j-row-index-jump'
import { getRepoMapFromState } from '@/store/selectors'
import { useAppStore } from '@/store'
import { isGitRepoKind } from '../../../shared/repo-kind'
import { buildTaskSourceContextFromRepo } from '../../../shared/task-source-context'
import type { WorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteQuickActions } from './use-worktree-jump-palette-quick-actions'
import type { WorktreeJumpPaletteSections } from './use-worktree-jump-palette-sections'
import type { WorktreeJumpPaletteSelectionActions } from './use-worktree-jump-palette-selection-actions'
import type { WorktreeJumpPaletteSelectionLifecycle } from './use-worktree-jump-palette-selection-lifecycle'
import type { WorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'
import type { WorktreeJumpPaletteWorktrees } from './use-worktree-jump-palette-worktrees'

type WorktreeJumpPaletteCreateActionInput = WorktreeJumpPaletteStoreState &
  WorktreeJumpPaletteLocalState &
  WorktreeJumpPaletteFilter &
  WorktreeJumpPaletteQuickActions &
  WorktreeJumpPaletteSections &
  WorktreeJumpPaletteSelectionActions &
  WorktreeJumpPaletteSelectionLifecycle &
  Pick<WorktreeJumpPaletteWorktrees, 'hasQuery'>

export function useWorktreeJumpPaletteCreateAction({
  digitShortcutItemsRef,
  paletteSections,
  visible,
  hasQuery,
  query,
  handleSelectItem,
  skipRestoreFocusRef,
  createWorktreeName,
  prefetchCreateWorkspaceBaseForComposer,
  closeModal,
  recordFeatureInteraction,
  openModal,
  allWorktrees,
  focusFallbackSurface,
  repoMap,
  createLookupGuard,
  preserveCreateLookupOnCloseRef,
  inputRef,
  setDialogElement
}: WorktreeJumpPaletteCreateActionInput) {
  useLayoutEffect(() => {
    digitShortcutItemsRef.current = paletteSections.visibleOpenTabItems
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the controller ref preserves its original stable identity.
  }, [paletteSections])
  useEffect(() => {
    if (!visible || hasQuery || query.length > 0) {
      return
    }
    return subscribeCmdJRowIndexJump((index) => {
      const item = digitShortcutItemsRef.current[index]
      if (item) {
        handleSelectItem(item)
      }
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the controller ref preserves its original stable identity.
  }, [handleSelectItem, hasQuery, query.length, visible])
  const handleCreateWorktree = useCallback(() => {
    skipRestoreFocusRef.current = true
    const trimmed = createWorktreeName.trim()
    const ghLink = parseGitHubIssueOrPRLink(trimmed)
    const ghNumber = parseGitHubIssueOrPRNumber(trimmed)
    const openComposer = (data: Record<string, unknown>): void => {
      prefetchCreateWorkspaceBaseForComposer(
        typeof data.initialRepoId === 'string' ? data.initialRepoId : undefined
      )
      closeModal()
      recordFeatureInteraction('cmd-j-create-workspace')
      queueMicrotask(() =>
        openModal('new-workspace-composer', { ...data, telemetrySource: 'command_palette' })
      )
    }
    if (ghLink) {
      const { number } = ghLink
      const state = useAppStore.getState()
      const matches = allWorktrees.filter(
        (worktree) =>
          !worktree.isArchived && (worktree.linkedIssue === number || worktree.linkedPR === number)
      )
      const activeMatch =
        matches.find((worktree) => worktree.repoId === state.activeRepoId) ?? matches[0]
      if (activeMatch) {
        closeModal()
        const activation = activateAndRevealWorktree(activeMatch.id)
        if (!queueWorkspaceActivationTerminalFocus(activeMatch.id, activation)) {
          focusFallbackSurface()
        }
        recordFeatureInteraction('cmd-j-workspace-open')
        return
      }
      const eligibleRepos = state.repos.filter((repo) => isGitRepoKind(repo))
      const repoForLookup =
        (state.activeRepoId && eligibleRepos.find((repo) => repo.id === state.activeRepoId)) ||
        eligibleRepos[0]
      openComposer(
        repoForLookup
          ? { prefilledName: trimmed, initialRepoId: repoForLookup.id }
          : { prefilledName: trimmed }
      )
      return
    }
    if (ghNumber !== null) {
      const state = useAppStore.getState()
      const matches = allWorktrees.filter(
        (worktree) =>
          !worktree.isArchived &&
          (worktree.linkedIssue === ghNumber || worktree.linkedPR === ghNumber)
      )
      const activeMatch =
        matches.find((worktree) => worktree.repoId === state.activeRepoId) ?? matches[0]
      if (activeMatch) {
        closeModal()
        const activation = activateAndRevealWorktree(activeMatch.id)
        if (!queueWorkspaceActivationTerminalFocus(activeMatch.id, activation)) {
          focusFallbackSurface()
        }
        recordFeatureInteraction('cmd-j-workspace-open')
        return
      }
      const repoForLookup =
        (state.activeRepoId ? (repoMap.get(state.activeRepoId) ?? null) : null) ||
        [...getRepoMapFromState(state).values()].find((repo) => isGitRepoKind(repo))
      if (!repoForLookup || !isGitRepoKind(repoForLookup)) {
        openComposer({ prefilledName: trimmed })
        return
      }
      prefetchCreateWorkspaceBaseForComposer(repoForLookup.id)
      const sourceContext = buildTaskSourceContextFromRepo({
        provider: 'github',
        projectId: repoForLookup.id,
        repo: repoForLookup
      })
      const lookupToken = createLookupGuard.start()
      preserveCreateLookupOnCloseRef.current = true
      recordFeatureInteraction('cmd-j-create-workspace')
      closeModal()
      void lookupGitHubWorkItemForSource({
        repoPath: repoForLookup.path,
        repoId: repoForLookup.id,
        sourceContext,
        number: ghNumber
      })
        .then((item) => {
          if (!createLookupGuard.isCurrent(lookupToken)) {
            return
          }
          const data: Record<string, unknown> = { initialRepoId: repoForLookup.id }
          if (item) {
            const linkedWorkItem: LinkedWorkItemSummary = {
              type: item.type,
              number: item.number,
              title: item.title,
              url: item.url
            }
            data.linkedWorkItem = linkedWorkItem
            data.prefilledName =
              getLinkedWorkItemWorkspaceName(linkedWorkItem)?.seedName ??
              getLinkedWorkItemSuggestedName({ title: item.title })
          } else {
            data.prefilledName = trimmed
          }
          queueMicrotask(() =>
            openModal('new-workspace-composer', { ...data, telemetrySource: 'command_palette' })
          )
        })
        .catch(() => {
          if (!createLookupGuard.isCurrent(lookupToken)) {
            return
          }
          queueMicrotask(() =>
            openModal('new-workspace-composer', {
              initialRepoId: repoForLookup.id,
              prefilledName: trimmed,
              telemetrySource: 'command_palette'
            })
          )
        })
      return
    }
    openComposer(trimmed ? { prefilledName: trimmed } : {})
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- controller refs preserve their original stable identities.
  }, [
    allWorktrees,
    closeModal,
    createLookupGuard,
    createWorktreeName,
    focusFallbackSurface,
    openModal,
    prefetchCreateWorkspaceBaseForComposer,
    recordFeatureInteraction,
    repoMap
  ])
  const handleCloseAutoFocus = useCallback((event: Event) => event.preventDefault(), [])
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the controller ref preserves its original stable identity.
  const focusPaletteInput = useCallback(() => inputRef.current?.focus(), [])
  const setDialogElementFromNode = useCallback((node: HTMLDivElement | null) => {
    setDialogElement(node?.closest<HTMLElement>('[role="dialog"]') ?? null)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- local-state setter identity is stable across extraction.
  }, [])
  const handleOpenAutoFocus = useCallback((_event: Event) => {
    // No-op: focus is captured before Radix moves it into the dialog.
  }, [])
  return {
    handleCreateWorktree,
    handleCloseAutoFocus,
    focusPaletteInput,
    setDialogElementFromNode,
    handleOpenAutoFocus
  }
}

export type WorktreeJumpPaletteCreateAction = ReturnType<typeof useWorktreeJumpPaletteCreateAction>
