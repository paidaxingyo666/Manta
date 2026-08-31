import type React from 'react'
import { Globe, Smartphone } from 'lucide-react'
import { CommandItem } from '@/components/ui/command'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { getPaletteHostBadge } from '@/components/cmd-j/palette-host-badge'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { BrowserPaletteItem, SimulatorPaletteItem } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteController } from './use-worktree-jump-palette-controller'
import {
  HighlightedText,
  PaletteHostBadgeChip,
  PaletteOpenTabPrimaryLine,
  PaletteRowShortcutBadge
} from './worktree-jump-palette-primitives'

export function WorktreeJumpPaletteSimulatorRow({
  entry,
  controller
}: {
  entry: SimulatorPaletteItem
  controller: WorktreeJumpPaletteController
}): React.JSX.Element {
  const result = entry.result
  const simulatorWorktree = controller.worktreeMap.get(result.worktreeId)
  const simulatorRepo = simulatorWorktree
    ? controller.repoMap.get(simulatorWorktree.repoId)
    : undefined
  const simulatorRepoName = simulatorRepo?.displayName ?? result.repoName
  const simulatorHostBadge = getPaletteHostBadge(
    simulatorRepo,
    controller.hostOptions,
    controller.hostFilterActive
  )

  return (
    <CommandItem
      key={entry.id}
      value={entry.id}
      onSelect={() => controller.handleSelectItem(entry)}
      className={cn(
        'group mx-0.5 flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow]',
        'data-[selected=true]:border-border data-[selected=true]:bg-accent data-[selected=true]:text-foreground'
      )}
    >
      <div className="flex h-5 w-4 shrink-0 items-center justify-center self-start text-muted-foreground/85">
        <Smartphone className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1 overflow-hidden">
            <PaletteOpenTabPrimaryLine
              title={result.title}
              titleRanges={result.titleRanges}
              secondaryText={result.secondaryText}
              secondaryRanges={result.secondaryRanges}
              worktreeName={result.worktreeName}
              worktreeRanges={result.worktreeRanges}
              leadingBadges={
                <>
                  {result.isCurrentTab && (
                    <span className="shrink-0 self-center rounded-[6px] border border-border/60 bg-background/45 px-1.5 py-px text-[9px] font-medium leading-normal text-muted-foreground/88">
                      {translate('auto.components.WorktreeJumpPalette.52404f8096', 'Current Tab')}
                    </span>
                  )}
                  {!result.isCurrentTab && result.isCurrentWorktree && (
                    <span className="shrink-0 self-center rounded-[6px] border border-border/60 bg-background/45 px-1.5 py-px text-[9px] font-medium leading-normal text-muted-foreground/88">
                      {translate(
                        'auto.components.WorktreeJumpPalette.c5081f2814',
                        'Current Worktree'
                      )}
                    </span>
                  )}
                </>
              }
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <PaletteHostBadgeChip badge={simulatorHostBadge} />
            {simulatorRepoName && (
              <span className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-[11px] font-semibold leading-none text-foreground">
                <RepoBadgeMark color={simulatorRepo?.badgeColor} />
                <span className="truncate">
                  <HighlightedText text={simulatorRepoName} matchRanges={result.repoRanges} />
                </span>
              </span>
            )}
            <PaletteRowShortcutBadge
              index={controller.recentTabShortcutIndexById.get(entry.id)}
              modifierKeys={controller.digitShortcutModifiers}
            />
          </div>
        </div>
      </div>
    </CommandItem>
  )
}

export function WorktreeJumpPaletteBrowserRow({
  entry,
  controller
}: {
  entry: BrowserPaletteItem
  controller: WorktreeJumpPaletteController
}): React.JSX.Element {
  const result = entry.result
  const browserWorktree = controller.worktreeMap.get(result.worktreeId)
  const browserRepo = browserWorktree ? controller.repoMap.get(browserWorktree.repoId) : undefined
  const browserRepoName = browserRepo?.displayName ?? result.repoName
  const browserHostBadge = getPaletteHostBadge(
    browserRepo,
    controller.hostOptions,
    controller.hostFilterActive
  )

  return (
    <CommandItem
      key={entry.id}
      value={entry.id}
      onSelect={() => controller.handleSelectItem(entry)}
      className={cn(
        'group mx-0.5 flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow]',
        'data-[selected=true]:border-border data-[selected=true]:bg-accent data-[selected=true]:text-foreground'
      )}
    >
      <div className="flex h-5 w-4 shrink-0 items-center justify-center self-start text-muted-foreground/85">
        <Globe className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1 overflow-hidden">
            <PaletteOpenTabPrimaryLine
              title={result.title}
              titleRanges={result.titleRanges}
              secondaryText={result.secondaryText}
              secondaryRanges={result.secondaryRanges}
              worktreeName={result.worktreeName}
              worktreeRanges={result.worktreeRanges}
              leadingBadges={
                <>
                  {result.isCurrentPage && (
                    <span className="shrink-0 self-center rounded-[6px] border border-border/60 bg-background/45 px-1.5 py-px text-[9px] font-medium leading-normal text-muted-foreground/88">
                      {translate('auto.components.WorktreeJumpPalette.52404f8096', 'Current Tab')}
                    </span>
                  )}
                  {!result.isCurrentPage && result.isCurrentWorktree && (
                    <span className="shrink-0 self-center rounded-[6px] border border-border/60 bg-background/45 px-1.5 py-px text-[9px] font-medium leading-normal text-muted-foreground/88">
                      {translate(
                        'auto.components.WorktreeJumpPalette.c5081f2814',
                        'Current Worktree'
                      )}
                    </span>
                  )}
                </>
              }
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <PaletteHostBadgeChip badge={browserHostBadge} />
            {browserRepoName && (
              <span className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-[11px] font-semibold leading-none text-foreground">
                <RepoBadgeMark color={browserRepo?.badgeColor} />
                <span className="truncate">
                  <HighlightedText text={browserRepoName} matchRanges={result.repoRanges} />
                </span>
              </span>
            )}
            <PaletteRowShortcutBadge
              index={controller.recentTabShortcutIndexById.get(entry.id)}
              modifierKeys={controller.digitShortcutModifiers}
            />
          </div>
        </div>
      </div>
    </CommandItem>
  )
}
