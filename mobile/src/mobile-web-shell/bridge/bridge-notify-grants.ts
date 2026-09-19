import { BRIDGE_FAULT_GRANT } from './bridge-envelope'

/**
 * Which `notify` names a grant gates, and whether the host will act on one.
 *
 * `foreground` and `terminalViewport` are the protocol's own and ride no grant, so they are not
 * listed. A name that is listed is served only when `init.grants.native` carried it — inert while
 * every page is offered `fault`, and load-bearing the moment a grant is per-route.
 */
export const BRIDGE_GRANT_GATED_NOTIFY_NAMES: readonly string[] = [BRIDGE_FAULT_GRANT]

export type BridgeNotifyRefusal = 'before-ready' | 'ungranted'

/**
 * Two refusals, not one.
 *
 * A page that has not asked for a session has been told nothing, so it holds no grant and cannot
 * have been given one. A page that has been told a list can still post a name outside it, and a
 * host issuing a grant is worth nothing if it serves the name anyway.
 */
export function bridgeNotifyRefusal(args: {
  name: string
  /** Whether this host has answered a `ready` yet, which is the only thing that issues grants. */
  initSent: boolean
  granted: readonly string[]
}): BridgeNotifyRefusal | null {
  if (!args.initSent) {
    return 'before-ready'
  }
  const gated = BRIDGE_GRANT_GATED_NOTIFY_NAMES.includes(args.name)
  return gated && !args.granted.includes(args.name) ? 'ungranted' : null
}
