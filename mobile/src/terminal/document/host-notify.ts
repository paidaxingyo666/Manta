import { scope } from './document-scope'

/**
 * The postMessage bridge to the host, and the engine error reporting that rides on it.
 *
 * They are one module because the document declares them together, ahead of the message router
 * that both serve.
 */

declare global {
  interface Window {
    __engineErrors: string[]
  }
}

export function notify(msg: Record<string, unknown>) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg))
  }
}

/** What a thrown value can be here: an Error-shaped object, a string, or nothing. */
export type TerminalEngineError = string | null | undefined | { message?: unknown }

export function engineErrorText(err: TerminalEngineError) {
  if (!err) {
    return ''
  }
  if (typeof err === 'string') {
    return err
  }
  if (err && typeof err.message === 'string') {
    return err.message
  }
  try {
    return String(err)
  } catch {
    return ''
  }
}

export function chromeVersionText() {
  const match = String(navigator.userAgent || '').match(/(?:Chrome|Chromium)\/([0-9.]+)/)
  return match ? 'Chrome ' + match[1] : 'Chrome version unknown'
}

let nonFatalErrorNotifies = 0

export function reportEngineError(context: string, err: TerminalEngineError, fatal?: unknown) {
  const isFatal = fatal === undefined ? !scope.everReady : !!fatal
  if (!isFatal) {
    // Why: a constructed-but-degraded engine can throw per frame; cap
    // non-fatal notifies so RN isn't flooded. Fatal reports always emit.
    nonFatalErrorNotifies++
    if (nonFatalErrorNotifies > 5) {
      return
    }
  }
  const parts = [context]
  const errText = engineErrorText(err)
  if (errText) {
    parts.push(errText)
  }
  if (window.__engineErrors && window.__engineErrors.length) {
    parts.push('captured: ' + window.__engineErrors.join(' | '))
  }
  parts.push(chromeVersionText())
  notify({
    type: 'error',
    fatal: isFatal,
    message: parts.join(' - ')
  })
}

window.onerror = function (
  msg: string | (Event & { message?: unknown }),
  source,
  line,
  column,
  err?: TerminalEngineError
) {
  if (window.__engineErrors.length < 20) {
    window.__engineErrors.push(String(msg))
  }
  reportEngineError('terminal runtime error', err || msg)
}
