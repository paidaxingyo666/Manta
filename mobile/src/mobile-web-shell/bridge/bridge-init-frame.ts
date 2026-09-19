import { BRIDGE_MAX_PENDING_REQUESTS, BRIDGE_MAX_SUBSCRIPTIONS } from './bridge-caps'
import {
  BRIDGE_FAULT_GRANT,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeConnectionSnapshot,
  type BridgeHostMessage,
  type BridgeInitRoute
} from './bridge-envelope'

/**
 * What `init` offers every page.
 *
 * A name added here is never a version bump. `fault` is what lets the page report that it could not
 * render, and it is offered to every page because it is the protocol's grant, not a screen's. The
 * host enforces this same list, so what the page is told and what it will be served cannot drift.
 */
export const BRIDGE_NATIVE_GRANTS: readonly string[] = [BRIDGE_FAULT_GRANT]

/** The one frame that starts a session, built in one place so its caps and its grants agree. */
export function createBridgeInitFrame(args: {
  sessionId: string
  buildId: string
  connection: BridgeConnectionSnapshot
  /** The screen this page stands in for, which the document's own `/` cannot tell it. */
  route: BridgeInitRoute
}): Extract<BridgeHostMessage, { type: 'init' }> {
  return {
    v: BRIDGE_PROTOCOL_VERSION,
    type: 'init',
    sessionId: args.sessionId,
    buildId: args.buildId,
    connection: args.connection,
    grants: {
      rpc: {
        maxPendingRequests: BRIDGE_MAX_PENDING_REQUESTS,
        maxSubscriptions: BRIDGE_MAX_SUBSCRIPTIONS
      },
      // Copied, not shared: the list the host enforces must not be reachable through a frame it
      // hands out.
      native: [...BRIDGE_NATIVE_GRANTS]
    },
    route: args.route
  }
}
