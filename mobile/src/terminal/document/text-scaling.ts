import { terminalTextScalePresets } from './document-constants'
import { scope } from './document-scope'
import { applyFitScale, getCellHeight } from './fit-scale'
import { getCellWidth } from './viewport-transform'
import { emitKeyboardAvoidanceMetrics } from './keyboard-avoidance-metrics'

export const scrollIndicator = document.getElementById('scroll-indicator')
export const scrollThumb = document.getElementById('scroll-thumb')
scope.scrollIndicatorHideTimer = null
scope.writeQueue = []
scope.writeQueueHead = 0
scope.writesDraining = false
scope.afterDrainCallbacks = []
scope.termObserverDisposables = []
scope.ready = false
// Why: init() flips ready false on every re-init (live width reflow included)
// while the old surface stays visible; a document-scoped latch drives the
// fatal/non-fatal decision so a transient reflow cannot blank a live terminal.
scope.everReady = false
scope.currentScale = 1
// Why: userScale is transient pinch zoom (CSS) for smooth feedback DURING a
// gesture only; it resets to 1 on release. The persistent "text size" is the
// real xterm fontSize (currentTextScale × BASE_FONT_PX), so changing it
// reflows the grid: a bigger cell means fewer columns fit, and RN re-measures
// and resizes the PTY (terminal.updateViewport) so the shell rewraps to the
// new width. A finished pinch snaps to the nearest preset and reports it to RN.
scope.userScale = 1
const BASE_FONT_PX = 13
const MIN_FONT_PX = 6
scope.MIN_FIT_COLS = 20
scope.currentTextScale = 1
const TEXT_SCALE_PRESETS = terminalTextScalePresets
scope.MIN_TEXT_SCALE = TEXT_SCALE_PRESETS[0]
scope.MAX_TEXT_SCALE = TEXT_SCALE_PRESETS[TEXT_SCALE_PRESETS.length - 1]
export function snapToTextScalePreset(value: number) {
  let best = TEXT_SCALE_PRESETS[0],
    bestDelta = Infinity
  for (let i = 0; i < TEXT_SCALE_PRESETS.length; i++) {
    const delta = Math.abs(TEXT_SCALE_PRESETS[i] - value)
    if (delta < bestDelta) {
      bestDelta = delta
      best = TEXT_SCALE_PRESETS[i]
    }
  }
  return best
}
export function fontPxForScale(scale: number) {
  return Math.max(MIN_FONT_PX, Math.round(BASE_FONT_PX * scale))
}
export function isIOSWebView() {
  if (/iP(ad|hone|od)/.test(navigator.userAgent)) {
    return true
  }
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}
// Why: iOS WebKit does not reliably resolve "SF Mono" by CSS family name and can
// fall to a non-monospace face; lead with the ui-monospace generic to avoid that.
const TERMINAL_FONT_FALLBACKS =
  '"Menlo", "Monaco", "Cascadia Mono", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "Symbols Nerd Font Mono", monospace'
scope.terminalFontFamily =
  (isIOSWebView() ? 'ui-monospace, ' : '"SF Mono", ') + TERMINAL_FONT_FALLBACKS
// Why: change the real font size, then resize the grid to fit the viewport at
// the new cell metrics so the text shows at its true size immediately. RN's
// refit (measure → updateViewport) then makes the server reflow the PTY to the
// same column count so the shell rewraps. cell metrics update on the frame
// after fontSize changes, so the resize/fit is deferred one rAF.
export function applyTextScale(scale: number) {
  scope.currentTextScale = scale
  if (!scope.term) {
    return
  }
  const px = fontPxForScale(scale)
  if (scope.term.options.fontSize === px) {
    return
  }
  scope.term.options.fontSize = px
  requestAnimationFrame(function () {
    if (!scope.term) {
      return
    }
    const cellW = getCellWidth()
    const cellH = getCellHeight()
    if (cellW > 0 && cellH > 0) {
      const cols = Math.floor(window.innerWidth / cellW)
      if (cols < scope.MIN_FIT_COLS) {
        return
      }
      const rows = Math.max(8, Math.floor(window.innerHeight / cellH))
      scope.term.resize(cols, rows)
      emitKeyboardAvoidanceMetrics()
    }
    applyFitScale('text-scale')
  })
}
