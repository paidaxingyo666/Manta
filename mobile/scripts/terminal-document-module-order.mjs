/**
 * The order the document's modules are spliced back into the script, which is the order the
 * hand-written document had. It is data, not a dependency graph: the document is one function
 * scope, so declarations must land where they landed before.
 *
 * Both the generator and the equivalence test read this, so neither can drift from the other.
 */
/** The scope object, emitted ahead of everything else because everything else reads it. */
export const TERMINAL_DOCUMENT_SCOPE_MODULE = 'document-scope'

export const TERMINAL_DOCUMENT_MODULE_ORDER = [
  'runtime-constants',
  'terminal-handle',
  'query-reply',
  'surface-swap',
  'text-scaling',
  'viewport-transform',
  'terminal-theme',
  'fit-scale',
  'mouse-mode-decset-scan',
  'write-queue',
  'webgl-recovery',
  'terminal-init',
  'reflow',
  'host-notify',
  'host-message-router',
  'selection-state-and-eviction',
  'mode-mirroring',
  'keyboard-avoidance-metrics',
  'term-observers',
  'viewport-cell',
  'mouse-report-cell',
  'mouse-input-encoding',
  'normal-buffer-smooth-scroll',
  'cell-geometry',
  'path-tap',
  'url-tap',
  'osc-link-tap',
  'surface-tap',
  'selection-range',
  'selection-overlay',
  'tap-dispatch',
  'wheel-scroll',
  'mouse-click-drag',
  'selection-menu-buttons',
  'surface-touch-gestures',
  'message-bridge'
]
