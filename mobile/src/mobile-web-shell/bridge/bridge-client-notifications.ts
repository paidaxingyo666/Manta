import type { ForegroundNudgeReason } from '../../transport/types'
import {
  BRIDGE_FAULT_GRANT,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeClientMessage
} from './bridge-envelope'
import { captureBridgeError } from './bridge-error-capture'

/** Everything the page tells the shell without waiting for an answer. */
export type BridgeClientNotifications = {
  updateTerminalSubscriptionViewport: (
    terminal: string,
    viewport: { cols: number; rows: number }
  ) => void
  notifyForeground: (reason?: ForegroundNudgeReason) => void
  notifyPageFault: (error: unknown) => boolean
}

export type BridgeClientNotificationDeps = {
  /** False when the frame never left the page. */
  send: (frame: BridgeClientMessage) => boolean
  /** Throws for a call that arrived before `init`, which is always a mount-order bug. */
  requireSession: () => void
  isClosed: () => boolean
  /** What `init.grants.native` listed, which is the only thing that makes a name safe to post. */
  hasGrant: (grant: string) => boolean
}

/**
 * The one-way half of the page's client.
 *
 * Two policies split them. The two the native contract declares answer nothing and throw before a
 * session, because a screen calling them early is a bug in this bundle. The fault report answers a
 * boolean and never throws, because its one caller is an error boundary and a report that threw
 * would replace the page's last word with an error nobody catches.
 */
export function createBridgeClientNotifications(
  deps: BridgeClientNotificationDeps
): BridgeClientNotifications {
  return {
    updateTerminalSubscriptionViewport: (terminal, viewport) => {
      deps.requireSession()
      if (deps.isClosed()) {
        return
      }
      deps.send({
        v: BRIDGE_PROTOCOL_VERSION,
        type: 'notify',
        name: 'terminalViewport',
        terminal,
        cols: viewport.cols,
        rows: viewport.rows
      })
    },
    notifyForeground: (reason?: ForegroundNudgeReason) => {
      deps.requireSession()
      if (deps.isClosed()) {
        return
      }
      deps.send({
        v: BRIDGE_PROTOCOL_VERSION,
        type: 'notify',
        name: 'foreground',
        ...(reason === undefined ? {} : { reason })
      })
    },
    notifyPageFault: (error: unknown) => {
      // Read rather than required: `requireSession` throws, and this is called from a
      // `componentDidCatch` where a throw is the second failure and the first one's grave.
      if (deps.isClosed() || !deps.hasGrant(BRIDGE_FAULT_GRANT)) {
        return false
      }
      return deps.send({
        v: BRIDGE_PROTOCOL_VERSION,
        type: 'notify',
        name: BRIDGE_FAULT_GRANT,
        error: captureBridgeError(error)
      })
    }
  }
}
