import { scope } from './document-scope'
import { clampPan, getCellHeight } from './fit-scale'
import { notify } from './host-notify'
import { attachSurfaceMouseClickDragHandler } from './mouse-click-drag'
import { routeScrollLines, shouldRouteScrollToTerminalInput } from './mouse-input-encoding'
import {
  applyNormalBufferScrollDelta,
  enqueueNormalBufferScrollDelta,
  resetSmoothScrollOffset
} from './normal-buffer-smooth-scroll'
import { dispatcherShouldBlockSurface } from './tap-dispatch'
import { applyTextScale, snapToTextScalePreset } from './text-scaling'
import { getTotalScale, updateTransform } from './viewport-transform'
import { attachSurfaceWheelHandler } from './wheel-scroll'

/** A surface that has already been wired, so a re-mount does not stack handlers. */
type TerminalGestureSurface = HTMLElement & { __orcaSurfaceHandlersAttached?: boolean }

/** The live touch gesture: the last point, the velocity, and the pinch it may be in. */
type TerminalTouchState = {
  lastX: number
  lastY: number
  lastTime: number
  velY: number
  accumDelta: number
  momentumId: number | null
  isPinching: boolean
  pinchDist: number
  pinchScale: number
  pinchSurfX: number
  pinchSurfY: number
}

const ts: TerminalTouchState = {
  lastX: 0,
  lastY: 0,
  lastTime: 0,
  velY: 0,
  accumDelta: 0,
  momentumId: null,
  isPinching: false,
  pinchDist: 0,
  pinchScale: 0,
  pinchSurfX: 0,
  pinchSurfY: 0
}

export function updateTouchVelocity(deltaY: number, dt: number) {
  if (dt <= 0) {
    return
  }
  const instantVelocity = deltaY / dt
  if (!Number.isFinite(instantVelocity)) {
    return
  }
  // Why: touchmove cadence is uneven in WebView. Blend recent samples so
  // momentum launch doesn't inherit a one-frame spike or stall.
  ts.velY = ts.velY === 0 ? instantVelocity : ts.velY * 0.55 + instantVelocity * 0.45
}

export function getDistance(a: Touch, b: Touch) {
  const dx = a.clientX - b.clientX,
    dy = a.clientY - b.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

export function attachSurfaceEventHandlers(targetSurface: TerminalGestureSurface) {
  if (!targetSurface || targetSurface.__mantaSurfaceHandlersAttached) {
    return
  }
  targetSurface.__mantaSurfaceHandlersAttached = true
  // Why: init() swaps in a new hidden surface to avoid flicker; each
  // replacement needs gesture handlers or tab-switch replays stop scrolling.
  targetSurface.addEventListener(
    'mousedown',
    function (e) {
      e.preventDefault()
      e.stopPropagation()
    },
    true
  )
  targetSurface.addEventListener(
    'click',
    function (e) {
      e.preventDefault()
      e.stopPropagation()
    },
    true
  )

  attachSurfaceWheelHandler(targetSurface)
  attachSurfaceMouseClickDragHandler(targetSurface)

  targetSurface.addEventListener(
    'touchstart',
    function (e) {
      if (dispatcherShouldBlockSurface()) {
        return
      }
      if (ts.momentumId) {
        cancelAnimationFrame(ts.momentumId)
        ts.momentumId = null
      }
      if (e.touches.length === 2) {
        ts.isPinching = true
        scope.smoothScrollOffsetY = 0
        ts.pinchDist = getDistance(e.touches[0], e.touches[1])
        ts.pinchScale = scope.userScale
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const total = getTotalScale()
        ts.pinchSurfX = (mx - scope.panX) / total
        ts.pinchSurfY = (my - scope.panY) / total
      } else if (e.touches.length === 1) {
        ts.isPinching = false
        ts.lastX = e.touches[0].clientX
        ts.lastY = e.touches[0].clientY
        ts.lastTime = Date.now()
        ts.velY = 0
        ts.accumDelta = 0
      }
    },
    { capture: true, passive: true }
  )

  targetSurface.addEventListener(
    'touchmove',
    function (e) {
      if (dispatcherShouldBlockSurface()) {
        return
      }
      if (!scope.term) {
        return
      }
      e.preventDefault()
      e.stopPropagation()

      if (e.touches.length === 2) {
        ts.isPinching = true
        const dist = getDistance(e.touches[0], e.touches[1])
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2

        const ratio = dist / ts.pinchDist
        // Why: userScale is a CSS multiplier on the current font size; bound it so
        // the resulting apparent size (currentTextScale × userScale) stays within
        // the preset range, since release snaps to one of those presets.
        const loScale = scope.MIN_TEXT_SCALE / scope.currentTextScale
        const hiScale = scope.MAX_TEXT_SCALE / scope.currentTextScale
        scope.userScale = Math.max(loScale, Math.min(hiScale, ts.pinchScale * ratio))
        const total = getTotalScale()
        scope.panX = mx - ts.pinchSurfX * total
        scope.panY = my - ts.pinchSurfY * total
        clampPan()
        updateTransform()
      } else if (e.touches.length === 1 && !ts.isPinching) {
        const x = e.touches[0].clientX,
          y = e.touches[0].clientY
        const now = Date.now(),
          dt = now - ts.lastTime

        // Why: pan horizontally only when content overflows the viewport (larger
        // than fit) — same check clampPan() uses. Vertical always drives buffer
        // scroll so scrollback stays reachable at any text size; calling the
        // never-defined contentWiderThanViewport() here threw and killed all
        // single-finger scrolling, scrollback included.
        if (
          scope.term.element &&
          scope.term.element.scrollWidth * getTotalScale() > window.innerWidth + 1
        ) {
          scope.panX += x - ts.lastX
          clampPan()
          updateTransform()
        }

        const deltaY = ts.lastY - y
        ts.lastTime = now
        if (shouldRouteScrollToTerminalInput()) {
          updateTouchVelocity(deltaY, dt)
          resetSmoothScrollOffset()
          const effectiveCellH = getCellHeight() * getTotalScale()
          ts.accumDelta += deltaY
          const lines = Math.trunc(ts.accumDelta / effectiveCellH)
          if (lines !== 0) {
            ts.accumDelta -= lines * effectiveCellH
            routeScrollLines(lines, x, y)
          }
        } else {
          if (enqueueNormalBufferScrollDelta(deltaY)) {
            updateTouchVelocity(deltaY, dt)
          } else {
            ts.velY = 0
          }
        }
        ts.lastX = x
        ts.lastY = y
      }
    },
    { capture: true, passive: false }
  )

  targetSurface.addEventListener(
    'touchend',
    function (e) {
      if (dispatcherShouldBlockSurface()) {
        return
      }
      if (!scope.term) {
        return
      }

      if (ts.isPinching && e.touches.length < 2) {
        ts.isPinching = false
        // Why: a finished pinch snaps to the nearest preset and becomes the new
        // font size (reflowing the grid), so pinch-to-zoom IS the in-terminal way
        // to set the text size. The CSS pinch zoom (userScale) is reset; the real
        // size change reflows columns and RN persists + resizes the PTY to match.
        const target = snapToTextScalePreset(scope.currentTextScale * scope.userScale)
        const changed = target !== scope.currentTextScale
        scope.userScale = 1
        scope.panX = 0
        scope.panY = 0
        applyTextScale(target)
        updateTransform()
        notify({ type: 'font-scale-changed', fontScale: target })
        if (changed) {
          notify({ type: 'haptic', kind: 'selection' })
        }
        if (e.touches.length === 1) {
          ts.lastX = e.touches[0].clientX
          ts.lastY = e.touches[0].clientY
          ts.lastTime = Date.now()
          ts.velY = 0
          ts.accumDelta = 0
        }
        return
      }

      if (e.touches.length === 0) {
        let vel = ts.velY
        const FRICTION = 0.972
        const MIN_VEL = 0.012
        function momentumStep() {
          vel *= FRICTION
          if (Math.abs(vel) < MIN_VEL) {
            ts.momentumId = null
            return
          }
          const delta = vel * 16
          if (shouldRouteScrollToTerminalInput()) {
            resetSmoothScrollOffset()
            const effectiveCellH = getCellHeight() * getTotalScale()
            ts.accumDelta += delta
            const lines = Math.trunc(ts.accumDelta / effectiveCellH)
            if (lines !== 0) {
              ts.accumDelta -= lines * effectiveCellH
              routeScrollLines(lines, ts.lastX, ts.lastY)
            }
          } else {
            if (!applyNormalBufferScrollDelta(delta)) {
              ts.momentumId = null
              return
            }
          }
          ts.momentumId = requestAnimationFrame(momentumStep)
        }
        if (Math.abs(vel) > MIN_VEL) {
          ts.momentumId = requestAnimationFrame(momentumStep)
        }
      }
    },
    { capture: true, passive: true }
  )
}

attachSurfaceEventHandlers(scope.surface!)
