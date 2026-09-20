import { flog } from './viewport-transform'
import { applyTerminalTheme } from './terminal-theme'
import { scope, type TerminalDocumentWebglAddon } from './document-scope'

/** xterm's WebGL addon constructor, as the engine bundle puts it on `window`. */
type WebglAddonGlobal = { WebglAddon?: new () => TerminalDocumentWebglAddon }

declare global {
  interface Window {
    WebglAddon?: WebglAddonGlobal
  }
}

export function refreshTerminalSurface() {
  if (!scope.term) {
    return
  }
  try {
    scope.term.refresh(0, Math.max(0, scope.term.rows - 1))
  } catch {}
}

export function cancelWebglContextRecovery() {
  if (!scope.webglRecoveryTimer) {
    return
  }
  clearTimeout(scope.webglRecoveryTimer)
  scope.webglRecoveryTimer = null
}

export function attachWebglAddon(allowRecovery: boolean) {
  if (!scope.term || !window.WebglAddon || !window.WebglAddon.WebglAddon) {
    return false
  }
  let addon: TerminalDocumentWebglAddon | null = null
  try {
    addon = new window.WebglAddon.WebglAddon()
    scope.webglAddon = addon
    if (addon.onContextLoss) {
      addon.onContextLoss(function () {
        if (scope.webglAddon !== addon) {
          return
        }
        flog('webgl-context-loss', { retry: allowRecovery })
        scope.webglAddon = null
        try {
          addon!.dispose()
        } catch {}
        refreshTerminalSurface()
        if (!allowRecovery) {
          return
        }
        // Why: one delayed retry handles transient iOS context loss without
        // entering a GPU crash loop; a second loss stays on the DOM renderer.
        cancelWebglContextRecovery()
        const recoveryTerm = scope.term
        const recoveryGeneration = scope.terminalGeneration
        scope.webglRecoveryTimer = setTimeout(function () {
          scope.webglRecoveryTimer = null
          if (scope.term !== recoveryTerm || scope.terminalGeneration !== recoveryGeneration) {
            return
          }
          attachWebglAddon(false)
        }, 100)
      })
    }
    scope.term.loadAddon(addon)
    if (!allowRecovery) {
      try {
        if (addon.clearTextureAtlas) {
          addon.clearTextureAtlas()
        }
      } catch {}
      refreshTerminalSurface()
    }
    return true
  } catch (e) {
    flog('webgl-attach-failed', { retry: !allowRecovery, message: String(e) })
    if (scope.webglAddon === addon) {
      scope.webglAddon = null
    }
    try {
      if (addon) {
        addon.dispose()
      }
    } catch {}
    refreshTerminalSurface()
    return false
  }
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') {
    return
  }
  // Why: iOS may restore the xterm model while discarding GPU pixels/theme
  // paint state, so visibility must rebuild the atlas and repaint every row.
  applyTerminalTheme(scope.terminalThemeInput)
  try {
    if (scope.webglAddon && scope.webglAddon.clearTextureAtlas) {
      scope.webglAddon.clearTextureAtlas()
    }
  } catch {}
  refreshTerminalSurface()
})
