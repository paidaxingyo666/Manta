/** One bridge host wired to a fake client, read back through the page's own reader.
 *  Shared because the suites that exercise it are split by concern, not by fixture. */
import {
  bridgeId,
  clientFrame,
  createFakeRpcClient,
  type FakeRpcClient
} from './bridge-host-test-fakes'
import { createBridgeHost, type BridgeHost, type BridgeHostDiagnostic } from './bridge-host'
import {
  readBridgeHostMessage,
  type BridgeHostMessage,
  type BridgeInitRoute
} from './bridge/bridge-envelope'
import type { BridgeErrorCapture } from './bridge/bridge-error-capture'

export const ID = bridgeId(1)
export const OTHER = bridgeId(2)

export type Harness = {
  host: BridgeHost
  client: FakeRpcClient
  posted: string[]
  diagnostics: BridgeHostDiagnostic[]
  pageFaults: BridgeErrorCapture[]
  pageReadyCount: () => number
  routeRefusals: string[]
  frames: () => BridgeHostMessage[]
  last: () => BridgeHostMessage
}

export const ROUTE = { pathname: '/h/host-a' }

export function harness(
  options: {
    client?: FakeRpcClient
    post?: (json: string) => Promise<void>
    route?: BridgeInitRoute
    onPageFault?: (error: BridgeErrorCapture) => void
  } = {}
): Harness {
  const client = options.client ?? createFakeRpcClient()
  const posted: string[] = []
  const diagnostics: BridgeHostDiagnostic[] = []
  const pageFaults: BridgeErrorCapture[] = []
  let pageReadies = 0
  const routeRefusals: string[] = []
  const host = createBridgeHost({
    client,
    post: (json) => {
      posted.push(json)
      return options.post?.(json) ?? Promise.resolve()
    },
    buildId: 'build-a',
    sessionId: 'session-a',
    route: options.route ?? ROUTE,
    onPageFault: (error) => {
      pageFaults.push(error)
      options.onPageFault?.(error)
    },
    onPageReady: () => {
      pageReadies += 1
    },
    onRouteRefused: (issue) => routeRefusals.push(issue),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  })
  // Read back through the page's own reader: a frame the host sends that the page would refuse is
  // a frame that never arrives, and this is the only place both halves meet in one test.
  const frames = (): BridgeHostMessage[] =>
    posted.map((json) => {
      const read = readBridgeHostMessage(json)
      if (!read.ok) {
        throw new Error(`the page would refuse this frame: ${read.refusal}`)
      }
      return read.message
    })
  return {
    host,
    client,
    posted,
    diagnostics,
    pageFaults,
    pageReadyCount: () => pageReadies,
    routeRefusals,
    frames,
    last: () => {
      const all = frames()
      const tail = all.at(-1)
      if (tail === undefined) {
        throw new Error('nothing was posted')
      }
      return tail
    }
  }
}

export function subscribeFrame(id: string, method = 'terminal.subscribe'): string {
  return clientFrame({ type: 'subscribe', id, method, params: { terminal: 't' } })
}
