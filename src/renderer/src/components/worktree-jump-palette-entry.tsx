import type React from 'react'
import { Plus } from 'lucide-react'
import { CommandItem } from '@/components/ui/command'
import { CREATE_WORKTREE_ITEM_ID } from '@/lib/worktree-palette-create-action'
import { translate } from '@/i18n/i18n'
import type { PaletteListEntry } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteController } from './use-worktree-jump-palette-controller'
import { WorktreeJumpPaletteWorktreeRow } from './worktree-jump-palette-worktree-row'
import {
  WorktreeJumpPaletteActionRow,
  WorktreeJumpPaletteProjectRow
} from './worktree-jump-palette-project-action-rows'
import { WorktreeJumpPaletteWorkspaceTabRow } from './worktree-jump-palette-workspace-tab-row'
import {
  WorktreeJumpPaletteBrowserRow,
  WorktreeJumpPaletteSimulatorRow
} from './worktree-jump-palette-browser-simulator-rows'

export function WorktreeJumpPaletteEntry({
  entry,
  controller
}: {
  entry: PaletteListEntry
  controller: WorktreeJumpPaletteController
}): React.JSX.Element {
  if (entry.type === 'section-header') {
    return (
      <div className="mx-0.5 mt-3 mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {entry.label}
      </div>
    )
  }
  if (entry.type === 'hint') {
    return (
      <div className="mx-0.5 mt-1 px-3 py-1.5 text-[12px] italic text-muted-foreground/70">
        {entry.label}
      </div>
    )
  }
  if (entry.type === 'create-worktree') {
    return (
      <CommandItem
        value={CREATE_WORKTREE_ITEM_ID}
        onSelect={controller.handleCreateWorktree}
        className="group mx-0.5 mt-1 flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-1.5 text-left outline-none transition-[background-color,border-color,box-shadow] data-[selected=true]:border-border data-[selected=true]:bg-accent data-[selected=true]:text-foreground"
      >
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border/60 bg-muted/25 text-muted-foreground/70">
          <Plus size={13} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
            {translate(
              'auto.components.WorktreeJumpPalette.95be6587d3',
              'Create worktree "{{value0}}"',
              { value0: controller.createWorktreeName }
            )}
          </div>
        </div>
      </CommandItem>
    )
  }
  if (entry.type === 'worktree') {
    return <WorktreeJumpPaletteWorktreeRow entry={entry} controller={controller} />
  }
  if (entry.type === 'project-target') {
    return <WorktreeJumpPaletteProjectRow entry={entry} controller={controller} />
  }
  if (entry.type === 'settings' || entry.type === 'quick-action') {
    return <WorktreeJumpPaletteActionRow entry={entry} controller={controller} />
  }
  if (entry.type === 'workspace-tab') {
    return <WorktreeJumpPaletteWorkspaceTabRow entry={entry} controller={controller} />
  }
  if (entry.type === 'simulator-tab') {
    return <WorktreeJumpPaletteSimulatorRow entry={entry} controller={controller} />
  }
  return <WorktreeJumpPaletteBrowserRow entry={entry} controller={controller} />
}
