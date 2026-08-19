export type DesktopWindowChromeInput = {
  platform: NodeJS.Platform
  isWebClient: boolean
}

export function isPairedWebClientWindow(): boolean {
  return (globalThis as { __MANTA_WEB_CLIENT__?: boolean }).__MANTA_WEB_CLIENT__ === true
}

export function isLocalWindowsDesktopClient(): boolean {
  return (
    !isPairedWebClientWindow() &&
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Windows')
  )
}

export function shouldRenderDesktopWindowChrome({
  platform,
  isWebClient
}: DesktopWindowChromeInput): boolean {
  return !isWebClient && (platform === 'win32' || platform === 'linux')
}
