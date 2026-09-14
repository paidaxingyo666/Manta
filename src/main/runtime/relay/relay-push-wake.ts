import type { RelaySessionBroker } from './relay-session-broker'

export type RelayPushWakeInput = {
  deviceToken: string
  payload: Record<string, unknown>
  collapseId?: string
}

/**
 * This fork's push wake, sent over the broker's active control connection.
 *
 * Kept out of RelaySessionBroker: that file is upstream's and sits exactly at
 * its line budget, so a method there fails lint and conflicts on every sync.
 */
export function pushWakeThroughBroker(
  broker: RelaySessionBroker,
  input: RelayPushWakeInput
): Promise<{ ok: boolean; discardToken: boolean }> {
  // Bracket access reaches the private pool without adding a line to upstream's class.
  const control = broker['originPool'].activeControl
  return control ? control.pushWake(input) : Promise.reject(new Error('relay_control_not_active'))
}
