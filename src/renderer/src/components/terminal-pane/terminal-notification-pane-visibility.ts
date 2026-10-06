export function isMantaWindowForegroundFocused(): boolean {
  if (typeof document === 'undefined') {
    return true
  }
  return document.visibilityState === 'visible' && document.hasFocus()
}
