import type { BrowserChromeShortcutScope } from './browser-page-types'

export function browserOverlayOwnsShortcutTarget(
  target: EventTarget | null,
  overlayTabId: string
): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return (
    target.closest('[data-browser-overlay-tab-id]')?.getAttribute('data-browser-overlay-tab-id') ===
    overlayTabId
  )
}

/** Whether a pane in this shortcut scope should answer a chrome-focus chord. */
export function browserChromeShortcutOwnsEvent(
  chromeShortcutScope: BrowserChromeShortcutScope,
  event: Event,
  workspaceId: string
): boolean {
  return (
    chromeShortcutScope === 'focused' ||
    (chromeShortcutScope === 'owned-target' &&
      browserOverlayOwnsShortcutTarget(event.target, workspaceId))
  )
}
