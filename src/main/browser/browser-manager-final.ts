import { MANTA_BROWSER_BLANK_URL } from '../../shared/constants'
import { normalizeBrowserNavigationUrl } from '../../shared/browser-url'
import { BrowserManagerEventForwarding } from './browser-manager-event-forwarding'

export abstract class BrowserManagerFinal extends BrowserManagerEventForwarding {
  protected openLinkInMantaTab(browserTabId: string, rawUrl: string): boolean {
    const renderer = this.resolveRendererForBrowserTab(browserTabId)
    if (!renderer) {
      return false
    }
    const normalizedUrl = normalizeBrowserNavigationUrl(rawUrl)
    if (!normalizedUrl || normalizedUrl === MANTA_BROWSER_BLANK_URL) {
      return false
    }
    // Why: only the renderer owns Manta's worktree/tab model; main forwards a validated URL, never letting guest content mutate it.
    renderer.send('browser:open-link-in-manta-tab', {
      browserPageId: browserTabId,
      url: normalizedUrl
    })
    return true
  }
}
