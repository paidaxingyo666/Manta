/**
 * The machines an account has on its relay.
 *
 * Read over HTTP rather than the relay control leg on purpose: the control leg
 * is only held open while something is actually paired, and a desktop with
 * nothing paired is exactly the one that needs to see the list.
 */
export type MantaRelayHostSummary = {
  relayHostId: string
  displayName?: string
  platform?: string
  appVersion?: string
  online: boolean
  lastSeenAt?: number
  /** True for the machine the list was requested from. */
  isThisMachine: boolean
}

export type ListMantaRelayHostsResult =
  | { status: 'ok'; hosts: MantaRelayHostSummary[] }
  /** The relay predates accounts; it has no directory to read. */
  | { status: 'unsupported' }
  | { status: 'unconfigured' }
  | { status: 'signed-out' }
  | { status: 'failed'; error: string }

export type ForgetMantaRelayHostArgs = { relayHostId: string }

export type ForgetMantaRelayHostResult =
  | { status: 'ok'; hosts: MantaRelayHostSummary[] }
  | { status: 'unsupported' }
  | { status: 'unconfigured' }
  | { status: 'signed-out' }
  | { status: 'failed'; error: string }
