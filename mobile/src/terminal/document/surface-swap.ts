import { disposeTermObservers } from './write-queue'
import { attachSurfaceEventHandlers } from './surface-touch-gestures'
import { scope, type TerminalDocumentTerminal } from './document-scope'

/** The surfaces and terminal a swap is replacing, handed back to whoever commits it. */
export type TerminalSurfaceSwap = {
  oldTerm: TerminalDocumentTerminal | null
  oldSurface: HTMLElement | null
  nextSurface: HTMLElement
}

// Why: phone-fit startup can issue several init() calls before xterm finishes
// replaying. Track the last painted surface separately from its replacement.
let committedTerm: TerminalDocumentTerminal | null = null
let committedSurface = scope.surface
scope.pendingTerm = null
let pendingSurface: HTMLElement | null = null

export function beginTerminalSurfaceSwap() {
  // Why: a superseded hidden replacement must not remain between the last
  // painted surface and the newest one, or the newest commits below the viewport.
  if (pendingSurface) {
    try {
      pendingSurface.remove()
    } catch {}
    if (scope.pendingTerm) {
      try {
        scope.pendingTerm.dispose()
      } catch {}
    }
    pendingSurface = null
    scope.pendingTerm = null
  }
  const swap = {
    oldTerm: committedTerm,
    oldSurface: committedSurface,
    nextSurface: document.createElement('div')
  }
  disposeTermObservers()
  swap.nextSurface.id = 'terminal-surface'
  swap.nextSurface.style.visibility = 'hidden'
  swap.nextSurface.style.position = 'absolute'
  swap.nextSurface.style.left = '0'
  swap.nextSurface.style.top = '0'
  document.getElementById('terminal-container')!.appendChild(swap.nextSurface)
  scope.surface = swap.nextSurface
  pendingSurface = swap.nextSurface
  attachSurfaceEventHandlers(scope.surface)
  swap.oldSurface!.removeAttribute('id')
  return swap
}

export function commitTerminalSurfaceSwap(
  swap: TerminalSurfaceSwap,
  nextTerm: TerminalDocumentTerminal
) {
  swap.nextSurface.style.visibility = 'visible'
  swap.nextSurface.style.position = ''
  swap.nextSurface.style.left = ''
  swap.nextSurface.style.top = ''
  swap.oldSurface!.remove()
  if (swap.oldTerm) {
    swap.oldTerm.dispose()
  }
  committedTerm = nextTerm
  committedSurface = swap.nextSurface
  scope.pendingTerm = null
  pendingSurface = null
}
