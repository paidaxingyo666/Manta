/**
 * A pairing code for this computer that works from anywhere.
 *
 * The runtime pairing code has always carried a LAN address, which is fine
 * between two machines on one network and useless everywhere else. Adding a
 * relay block to it makes the same code reachable through the cell — the same
 * leg a phone uses, with the scope deciding which RPC surface the peer gets.
 *
 * Pairing stays an explicit act on the machine being reached. Two computers
 * sharing an account is not consent for one to open a shell on the other, so
 * the account never mints these; a person does.
 */
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'
import type { PairingRelay } from '../../shared/mobile-relay-pairing-offer'
import {
  mobileRelayMintFailureFromUnknown,
  type MobileRelayMintFailure
} from '../../shared/mobile-relay-mint-failure'
import type { RelayDeviceBinding } from './relay/relay-revoke-outbox'

export type RuntimeRelayPairingDeps = {
  /** The direct offer this one is built on: endpoint, token, and device id. */
  direct: { pairingUrl: string; endpoint: string; deviceId: string; webClientUrl: string | null }
  publicKeyB64: string
  deviceToken: (deviceId: string) => string | null
  createPairingRelay: (
    relayDeviceId: string
  ) => Promise<{ relay: PairingRelay; binding: RelayDeviceBinding }>
  bindRelay: (deviceId: string, binding: RelayDeviceBinding) => boolean
  releaseRelay: (deviceId: string, binding: RelayDeviceBinding) => void
}

export type RuntimeRelayPairingOffer =
  | {
      available: true
      pairingUrl: string
      endpoint: string
      deviceId: string
      webClientUrl: string | null
      relayHostId: string
    }
  | {
      available: false
      reason: 'relay_mint_failed'
      guidance: string
      relayFailure: MobileRelayMintFailure
    }

const GUIDANCE =
  'Manta Relay could not create a pairing invite. Check that this computer is signed in to a relay, then try again.'

function refuse(relayFailure: MobileRelayMintFailure): RuntimeRelayPairingOffer {
  return { available: false, reason: 'relay_mint_failed', guidance: GUIDANCE, relayFailure }
}

export async function buildRuntimeRelayPairingOffer(
  deps: RuntimeRelayPairingDeps
): Promise<RuntimeRelayPairingOffer> {
  const { direct } = deps
  const deviceToken = deps.deviceToken(direct.deviceId)
  if (!deviceToken) {
    return refuse({
      code: 'relay_binding_failed',
      stage: 'binding_failed',
      message: 'The pairing credential disappeared before the relay invite was minted'
    })
  }
  let minted: Awaited<ReturnType<RuntimeRelayPairingDeps['createPairingRelay']>>
  try {
    minted = await deps.createPairingRelay(direct.deviceId)
  } catch (error) {
    // The raw provider error can carry request metadata or credentials; only
    // the validated code is safe to keep.
    return refuse(
      mobileRelayMintFailureFromUnknown({
        stage: 'create_pairing_relay',
        error,
        fallbackCode: 'relay_mint_failed',
        fallbackMessage: 'Relay pairing invite request failed'
      })
    )
  }
  if (!deps.bindRelay(direct.deviceId, minted.binding)) {
    // The invite exists on the relay but nothing here remembers it, so it has
    // to be revoked rather than left to expire against a credential nobody holds.
    deps.releaseRelay(direct.deviceId, minted.binding)
    return refuse({
      code: 'relay_binding_failed',
      stage: 'binding_failed',
      message: 'Could not store the relay binding for the pairing credential'
    })
  }
  return {
    available: true,
    endpoint: direct.endpoint,
    deviceId: direct.deviceId,
    webClientUrl: direct.webClientUrl,
    relayHostId: minted.relay.relayHostId,
    pairingUrl: encodePairingOffer({
      v: PAIRING_OFFER_VERSION,
      endpoint: direct.endpoint,
      deviceToken,
      publicKeyB64: deps.publicKeyB64,
      pairedDeviceId: direct.deviceId,
      scope: 'runtime',
      relay: minted.relay
    })
  }
}
