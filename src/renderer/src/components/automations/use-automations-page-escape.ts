import { useEffect } from 'react'
import type { AutomationsPageLocalState } from './use-automations-page-local-state'
import type { AutomationsPageStoreState } from './use-automations-page-store-state'

export function useAutomationsPageEscape({
  store,
  local
}: {
  store: AutomationsPageStoreState
  local: AutomationsPageLocalState
}): void {
  const { closeAutomationsPage } = store
  const { createOpen, deleteTarget, externalDeleteTarget } = local
  useEffect(() => {
    if (createOpen || deleteTarget || externalDeleteTarget) {
      return
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }

      const target = event.target
      if (target instanceof Element) {
        // Fields that clear their own value on Escape consume this press.
        if (target.getAttribute('data-escape-clears-value') === 'true') {
          return
        }

        // Esc first exits field focus, then exits the page, matching the Tasks page.
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable) ||
          target.matches('[contenteditable="true"], [contenteditable=""]')
        ) {
          event.preventDefault()
          if (target instanceof HTMLElement) {
            target.blur()
          }
          return
        }
      }

      event.preventDefault()
      closeAutomationsPage()
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [closeAutomationsPage, createOpen, deleteTarget, externalDeleteTarget])
}
