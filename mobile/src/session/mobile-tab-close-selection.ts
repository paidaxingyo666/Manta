import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'
export type BulkTabCloseMode = 'others' | 'left' | 'right'

/** Long-press sheet entries, in display order. */
export const bulkTabCloseActions = localizedConstant(
  (): { mode: BulkTabCloseMode; label: string }[] => [
    {
      mode: 'others',
      label: translate(
        'auto.mobile.src.session.mobile.tab.close.selection.5f17f23257',
        'Close Other Tabs'
      )
    },
    {
      mode: 'left',
      label: translate(
        'auto.mobile.src.session.mobile.tab.close.selection.fe28cadb0a',
        'Close Tabs to the Left'
      )
    },
    {
      mode: 'right',
      label: translate(
        'auto.mobile.src.session.mobile.tab.close.selection.417f514e07',
        'Close Tabs to the Right'
      )
    }
  ]
)

type BulkClosableTab = {
  id: string
  isDirty?: boolean
  isPinned?: boolean
}

/**
 * Pick the tabs a long-press bulk close ("Close Other Tabs" / "Close Tabs to
 * the Left/Right") should target, in strip order relative to the pressed tab.
 * Dirty documents are skipped — mobile has no save prompt on close, so bulk
 * closing must never silently discard unsaved edits.
 */
export function selectBulkCloseTabs<T extends BulkClosableTab>(
  tabs: readonly T[],
  anchorTabId: string,
  mode: BulkTabCloseMode
): T[] {
  const anchorIndex = tabs.findIndex((tab) => tab.id === anchorTabId)
  if (anchorIndex === -1) {
    return []
  }
  const candidates =
    mode === 'others'
      ? tabs.filter((_, index) => index !== anchorIndex)
      : mode === 'left'
        ? tabs.slice(0, anchorIndex)
        : tabs.slice(anchorIndex + 1)
  return candidates.filter((tab) => tab.isDirty !== true && tab.isPinned !== true)
}
