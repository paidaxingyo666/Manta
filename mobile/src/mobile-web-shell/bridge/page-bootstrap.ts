import {
  createBridgeRpcClient,
  type BridgeRpcClient,
  type BridgeRpcClientDiagnostic,
  type BridgeShellSession
} from './bridge-rpc-client'
import {
  createOrcaBridgePageTransport,
  readOrcaBridgePageChannel
} from './manta-bridge-page-channel'

/**
 * How far the page's bootstrap got, in one attribute.
 *
 * The state is the only thing that tells a document which never ran its script from one that ran
 * it and threw, and from one still waiting on a shell that has not answered. `unbridged` is
 * terminal: nothing is coming, because nothing installed a channel on this document.
 */
export type PageMountState = 'started' | 'unbridged' | 'shell-ready' | 'mounted'

/** `dataset` keys, so a screenshot, the render check and a device console read the same three facts. */
export const PAGE_MOUNT_STATE_KEY = 'orcaWebEntry'
export const PAGE_SESSION_ID_KEY = 'orcaWebSessionId'
export const PAGE_BUILD_ID_KEY = 'orcaWebBuildId'

/** The document element, narrowed to the one thing the page writes on it. */
export type PageMountTarget = { dataset: DOMStringMap }

export function stampPageMountState(target: PageMountTarget, state: PageMountState): void {
  target.dataset[PAGE_MOUNT_STATE_KEY] = state
}

/** One line per kind for the life of one page: a page that is failing frames fails all of them. */
export function createPageDiagnosticReporter(): (diagnostic: BridgeRpcClientDiagnostic) => void {
  const reported = new Set<BridgeRpcClientDiagnostic['kind']>()
  return (diagnostic) => {
    if (reported.has(diagnostic.kind)) {
      return
    }
    reported.add(diagnostic.kind)
    console.warn('[page-bridge]', diagnostic.kind, diagnostic)
  }
}

/**
 * The page's one client, or `null` for a document opened outside the shell.
 *
 * One `onmessage` slot exists on the channel, so a second client would silently take the first
 * one's frames; the page builds this once, at the entry, and hands the same client to the provider.
 */
export function createShellPageClient(): BridgeRpcClient | null {
  const channel = readOrcaBridgePageChannel()
  if (channel === null) {
    return null
  }
  return createBridgeRpcClient({
    ...createOrcaBridgePageTransport(channel),
    onDiagnostic: createPageDiagnosticReporter()
  })
}

/**
 * Mounts the route tree once `init` has landed, and never before it.
 *
 * Nothing mounts against a session-less client: the page's getters are synchronous reads of a cache
 * `init` primes, so a screen that rendered first would record its first frame against a client that
 * knows no host, no state and no build. A document with no channel is not inside the shell and no
 * `init` is ever coming, so it says so and stops rather than waiting out a backoff nobody answers.
 */
export function bootstrapShellPage(options: {
  target: PageMountTarget
  client: BridgeRpcClient | null
  mount: (client: BridgeRpcClient, session: BridgeShellSession) => void
}): void {
  const { target, client, mount } = options
  if (client === null) {
    stampPageMountState(target, 'unbridged')
    return
  }
  const mountWithSession = (): boolean => {
    const session = client.getShellSession()
    if (session === null) {
      return false
    }
    target.dataset[PAGE_SESSION_ID_KEY] = session.sessionId
    target.dataset[PAGE_BUILD_ID_KEY] = session.buildId
    stampPageMountState(target, 'shell-ready')
    mount(client, session)
    return true
  }
  if (mountWithSession()) {
    return
  }
  // `onReady` fires once and clears its listeners, so one document mounts one tree: a later `init`
  // under a new session id fails what the page held rather than mounting a second route tree over it.
  client.onReady(() => {
    mountWithSession()
  })
}
