import type { RelaySessionBroker } from './relay-session-broker'
import type { RelayRevokeOutbox, RelayRevokeOutboxItem } from './relay-revoke-outbox'

/**
 * Drains the durable revoke queue against a live broker.
 *
 * Split out of DesktopRelayService because it is the one piece of that class
 * with its own durability contract: the outbox entry, not the in-flight call, is
 * the source of truth, so a failure here is expected rather than exceptional.
 */
export async function flushRelayRevokeOutbox(
  outbox: RelayRevokeOutbox,
  broker: RelaySessionBroker,
  onDrained: () => void
): Promise<void> {
  for (const item of outbox.pendingFor(broker.ownerIdentityKey, broker.hostId)) {
    await flushOne(outbox, broker, item, onDrained)
  }
}

async function flushOne(
  outbox: RelayRevokeOutbox,
  broker: RelaySessionBroker,
  item: RelayRevokeOutboxItem,
  onDrained: () => void
): Promise<void> {
  try {
    await broker.revokeDevice(item.relayDeviceId, item.reqId)
    outbox.remove(item.reqId)
    onDrained()
  } catch {
    // Why swallow: the durable item is the source of truth; reconnecting the
    // same account/control retries this stable reqId without delaying the local
    // revoke that already happened.
  }
}
