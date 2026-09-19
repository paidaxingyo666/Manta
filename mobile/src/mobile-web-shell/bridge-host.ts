import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import type { ConnectionState, RpcResponse } from '../transport/types'
import {
  BridgeCapExceededError,
  BridgeHostDisposedError,
  BridgeReplyUndeliverableError
} from './bridge-host-errors'
import { BridgeHostSubscriptions } from './bridge-host-subscriptions'
import { BRIDGE_MAX_PENDING_REQUESTS, BRIDGE_MAX_SUBSCRIPTIONS } from './bridge/bridge-caps'
import {
  BRIDGE_FAULT_GRANT,
  BRIDGE_PROTOCOL_VERSION,
  BridgeInitRouteSchema,
  readBridgeClientMessage,
  type BridgeClientMessage,
  type BridgeConnectionSnapshot,
  type BridgeHostMessage
} from './bridge/bridge-envelope'
import { captureBridgeError } from './bridge/bridge-error-capture'
import { BRIDGE_NATIVE_GRANTS, createBridgeInitFrame } from './bridge/bridge-init-frame'
import { bridgeNotifyRefusal } from './bridge/bridge-notify-grants'
import { splitBridgeReply } from './bridge/bridge-reply-chunking'
import type { BridgeHostOptions } from './bridge-host-contract'

// Re-exported so a caller reaches the host and what it reports through one module.
export type { BridgeHostDiagnostic, BridgeHostOptions } from './bridge-host-contract'

type RequestMessage = Extract<BridgeClientMessage, { type: 'request' }>
type SubscribeMessage = Extract<BridgeClientMessage, { type: 'subscribe' }>
type NotifyMessage = Extract<BridgeClientMessage, { type: 'notify' }>

/** Live until something settles it; the flag is what keeps a cancelled request's late answer from
 *  being posted under an id the page has moved on from. */
type PendingRequest = { live: boolean }

export type BridgeHost = {
  receive: (json: string) => void
  dispose: () => void
}

/**
 * One page document's end of the bridge: page frames in, host frames out, one RPC client behind it.
 *
 * The fence is structural rather than checked. The protocol names no host, so a page cannot ask for
 * one: the client is whichever this host was built with, and a page that outlives its session has
 * its frames refused at the native origin check before this module ever sees them. The caps the
 * page is told about in `init` are enforced here and not trusted from there.
 */
export function createBridgeHost(options: BridgeHostOptions): BridgeHost {
  const { client, buildId, sessionId } = options
  // Parsed here, once, against the same schema the page reads it with. The producer interpolates a
  // host id into a pathname, so a host id carrying `?`, `#`, whitespace or a dot segment reaches
  // the wire as a route no page will accept; without this the page refuses the whole `init`, asks
  // again on its backoff forever, and the shell un-hides a WebView that will never paint.
  const parsedRoute = BridgeInitRouteSchema.safeParse(options.route)
  const route = parsedRoute.success ? parsedRoute.data : null
  const pending = new Map<string, PendingRequest>()
  let closed = false
  // Requests the client is still running. `pending` is the page's view and empties on a cancel or a
  // `close`, but `sendRequest` has no cancel: the call keeps its slot on the wire until it settles,
  // and a page that closed between batches would otherwise be handed the cap over again.
  let inFlight = 0
  // One document's turn at the bridge. `close` ends it and the next `ready` begins the next one;
  // between the two the view belongs to no document, so nothing is served and nothing is posted.
  // No epoch rides along: one native listener delivers page frames in order, so a straggler from
  // the closed document is always behind it and ahead of the next document's `ready`.
  let serving = true
  // Whether this host has ever answered a `ready`. Not the same as `serving`, which starts true so
  // the first document's frames are not refused for arriving in the same batch as its `ready`: this
  // one starts false, because a page that has been told no grants holds none.
  let initSent = false
  let postFailureReported = false
  let notifyFailureReported = false

  // Once per session: a page that cannot be posted to fails every frame after the first, and a
  // line per frame buries the one that says why.
  function reportPostFailure(error: unknown): void {
    if (postFailureReported) {
      return
    }
    postFailureReported = true
    options.onDiagnostic?.({ kind: 'post-failed', error })
  }

  function sendJson(json: string): void {
    // Defensive: teardown already settles everything that could post; this fences callers added later.
    if (closed) {
      return
    }
    // Between documents the view still exists and still accepts posts, which is exactly why this is
    // checked: a `state` frame sent now lands in the next document before it has said `ready`.
    if (!serving) {
      return
    }
    // A `post` that throws where it should reject would escape into the client's own state-change
    // fan-out, which is what sends the `state` frame, and take the other listeners down with it.
    try {
      void options.post(json).catch(reportPostFailure)
    } catch (error) {
      reportPostFailure(error)
    }
  }

  // Every value in a host frame has already been serialized by whoever produced it — a reply by
  // `splitBridgeReply`, an error `code` by the capture's round trip — so this cannot throw.
  function send(frame: BridgeHostMessage): void {
    sendJson(JSON.stringify(frame))
  }

  function sendError(id: string, error: unknown): void {
    send({ v: BRIDGE_PROTOCOL_VERSION, type: 'error', id, error: captureBridgeError(error) })
  }

  const subscriptions = new BridgeHostSubscriptions({ client, post: sendJson })

  /** `state` is the event's own value: a listener can run before the getter it mirrors is updated. */
  function snapshot(state?: ConnectionState): BridgeConnectionSnapshot {
    return {
      state: state ?? client.getState(),
      reconnectAttempt: client.getReconnectAttempt(),
      lastConnectedAt: client.getLastConnectedAt(),
      lastInboundAt: client.getLastInboundAt?.() ?? null,
      generation: client.getGeneration?.() ?? null
    }
  }

  // Answered every time it is asked: a page that saw a `state` older than the one it holds recovers
  // by asking again rather than by living with a cache it knows is wrong.
  function sendInit(): void {
    if (route === null) {
      return
    }
    initSent = true
    send(createBridgeInitFrame({ sessionId, buildId, connection: snapshot(), route }))
  }

  function settle(id: string, record: PendingRequest): boolean {
    if (!record.live) {
      return false
    }
    record.live = false
    pending.delete(id)
    return true
  }

  /** The arity the page used, replayed exactly: `sendRequest(m)` and `sendRequest(m, undefined)`
   *  are different calls to the golden recorder. */
  function forwardRequest(message: RequestMessage): Promise<RpcResponse> {
    if (message.options !== undefined) {
      return client.sendRequest(message.method, message.params, message.options)
    }
    return 'params' in message
      ? client.sendRequest(message.method, message.params)
      : client.sendRequest(message.method)
  }

  function sendReply(id: string, payload: RpcResponse): void {
    const split = splitBridgeReply(id, payload)
    if (!split.ok) {
      sendError(id, new BridgeReplyUndeliverableError(split.refusal))
      return
    }
    for (const frame of split.frames) {
      send(frame)
    }
  }

  /** An id already in flight is a page bug; refusing the newcomer leaves the exchange it collided
   *  with intact, which settling it would not. */
  function idInFlight(id: string): boolean {
    return pending.has(id) || subscriptions.has(id)
  }

  function handleRequest(message: RequestMessage): void {
    const { id } = message
    if (idInFlight(id)) {
      sendError(id, new BridgeCapExceededError('that id is already in flight'))
      return
    }
    if (inFlight >= BRIDGE_MAX_PENDING_REQUESTS) {
      sendError(id, new BridgeCapExceededError(`over ${BRIDGE_MAX_PENDING_REQUESTS} requests`))
      return
    }
    const record: PendingRequest = { live: true }
    pending.set(id, record)
    let answer: Promise<RpcResponse>
    try {
      answer = forwardRequest(message)
    } catch (error) {
      settle(id, record)
      sendError(id, error)
      return
    }
    inFlight += 1
    void answer.then(
      (payload) => {
        inFlight -= 1
        if (settle(id, record)) {
          sendReply(id, payload)
        }
      },
      (error: unknown) => {
        inFlight -= 1
        if (settle(id, record)) {
          sendError(id, error)
        }
      }
    )
  }

  // `wantsBinary` is read by the contract and acted on in C6, which owns the screencast encoder and
  // the measurement that earns it. Until then every stream crosses as JSON.
  function handleSubscribe(message: SubscribeMessage): void {
    const { id } = message
    if (idInFlight(id)) {
      sendError(id, new BridgeCapExceededError('that id is already in flight'))
      return
    }
    if (subscriptions.size >= BRIDGE_MAX_SUBSCRIPTIONS) {
      sendError(id, new BridgeCapExceededError(`over ${BRIDGE_MAX_SUBSCRIPTIONS} subscriptions`))
      return
    }
    try {
      subscriptions.start(id, message.method, message.params)
    } catch (error) {
      sendError(id, error)
    }
  }

  /** The client's own work runs inside these calls, and a throw from one would otherwise escape into
   *  the native event handler that delivered the page's frame. Nothing is owed to the page here. */
  function forwardNotify(message: NotifyMessage): void {
    const refusal = bridgeNotifyRefusal({
      name: message.name,
      initSent,
      granted: BRIDGE_NATIVE_GRANTS
    })
    if (refusal !== null) {
      options.onDiagnostic?.({ kind: 'notify-refused', name: message.name, why: refusal })
      return
    }
    try {
      if (message.name === BRIDGE_FAULT_GRANT) {
        // Not the client's: a page that threw is this session's problem, and the desktop on the
        // other end of the client has nothing to do with it.
        options.onPageFault(message.error)
        return
      }
      if (message.name === 'foreground') {
        if (message.reason === undefined) {
          client.notifyForeground()
        } else {
          client.notifyForeground(message.reason)
        }
        return
      }
      client.updateTerminalSubscriptionViewport(message.terminal, {
        cols: message.cols,
        rows: message.rows
      })
    } catch (error) {
      // Once per session, for the reason a failing post is: a page nudging a broken listener nudges
      // it again on every foreground.
      if (notifyFailureReported) {
        return
      }
      notifyFailureReported = true
      options.onDiagnostic?.({ kind: 'notify-failed', error })
    }
  }

  /** Cancels everything the page had open. `notify` is false for the page's own `close`, which has
   *  already settled what it owned. */
  function settleAll(notify: boolean): void {
    for (const [id, record] of pending) {
      record.live = false
      // In flight when the door shut: the desktop may already have run it, and a page told this was
      // a definite send failure would offer to retry something that already happened.
      if (notify) {
        sendError(id, markRpcDeliveryUnknown(new BridgeHostDisposedError()))
      }
    }
    pending.clear()
    subscriptions.closeAll(notify ? 'closed' : null)
  }

  function dispose(): void {
    if (closed) {
      return
    }
    settleAll(true)
    closed = true
    unsubscribeState()
  }

  function dispatch(message: BridgeClientMessage): void {
    // `ready` is what claims the view, whether it is the first document's or a replacement's; a
    // re-asked `ready` from the document already being served is answered the same way.
    if (message.type === 'ready') {
      serving = true
      sendInit()
      // Every time it is asked, not once: the page re-asks on a backoff, and the shell's wait ends
      // on the first of those that lands rather than on a particular one.
      options.onPageReady()
      return
    }
    if (!serving) {
      options.onDiagnostic?.({ kind: 'frame-after-close' })
      return
    }
    switch (message.type) {
      case 'request':
        handleRequest(message)
        return
      case 'subscribe':
        handleSubscribe(message)
        return
      case 'cancel': {
        if (message.target === 'subscription') {
          subscriptions.cancel(message.id, 'unsubscribed')
          return
        }
        // `sendRequest` has no cancel: the desktop still runs it, and this only stops the host from
        // posting an answer under an id the page has stopped waiting on.
        const record = pending.get(message.id)
        if (record !== undefined) {
          settle(message.id, record)
        }
        return
      }
      case 'ack':
        subscriptions.ack(message.id, message.seq)
        return
      case 'notify':
        forwardNotify(message)
        return
      case 'close':
        // Not a latch. The document that loads next into this same view says `ready` over this same
        // host, and a host that had shut itself would leave that `ready` retrying forever.
        settleAll(false)
        serving = false
        return
    }
  }

  const unsubscribeState = client.onStateChange((state) => {
    send({ v: BRIDGE_PROTOCOL_VERSION, type: 'state', connection: snapshot(state) })
  })

  if (route === null) {
    // At construction rather than on the first `ready`: the verdict does not depend on the page
    // behaving, and a shell that waited for a frame would hold a blank view until one arrived.
    const issue = parsedRoute.success
      ? 'unknown'
      : (parsedRoute.error.issues[0]?.message ?? 'unknown')
    options.onDiagnostic?.({ kind: 'route-refused', issue })
    options.onRouteRefused(issue)
  }

  return {
    receive(json: string): void {
      if (closed) {
        // Only a disposed host reaches this, and it can neither answer the frame nor refuse it.
        options.onDiagnostic?.({ kind: 'frame-after-dispose' })
        return
      }
      const read = readBridgeClientMessage(json)
      if (!read.ok) {
        options.onDiagnostic?.({ kind: 'refused', refusal: read.refusal })
        return
      }
      dispatch(read.message)
    },
    dispose
  }
}
