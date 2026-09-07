import type { ApnsClient } from './apns-client.js'
import type { PushDeviceRegistryStore } from './device-registry-store.js'
import type { FcmClient } from './fcm-client.js'
import { fingerprintLogPrefix } from './host-fingerprint.js'
import type { PushDelivery } from './push-delivery-message.js'
import type { PushProviderOutcome } from './push-provider-outcome.js'

export type PushDispatcherOptions = {
  devices: PushDeviceRegistryStore
  apns?: ApnsClient
  fcm?: FcmClient
  wait?: (ms: number) => Promise<void>
  now?: () => number
  onRetry?: () => void
  onOutcome?: (outcome: PushProviderOutcome['status']) => void
}

// Sends one coalesced delivery through the provider the registration belongs
// to, and retires the registration when the provider says the token is gone.
export class PushDispatcher {
  constructor(private readonly options: PushDispatcherOptions) {}

  async deliver(delivery: PushDelivery): Promise<void> {
    const now = this.options.now ?? Date.now
    const deadline = now() + 120_000
    for (let attempt = 0; attempt < 3; attempt++) {
      if (now() >= deadline) return
      const retry = await this.deliverAttempt(delivery)
      if (!retry || attempt === 2) return
      const delay = Math.max(retry.delayMs, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250)
      if (now() + delay >= deadline) return
      this.options.onRetry?.()
      await (this.options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
        delay
      )
    }
  }

  private async deliverAttempt(delivery: PushDelivery): Promise<{ delayMs: number } | undefined> {
    const device = await this.options.devices.findById(delivery.registrationId)
    if (!device || device.dead) return
    let outcome: PushProviderOutcome
    if (device.platform === 'ios') {
      outcome = this.options.apns
        ? await this.options.apns.send(delivery, {
            token: device.token,
            apnsEnvironment: device.apnsEnvironment ?? 'production'
          })
        : { status: 'error', reason: 'apns_not_configured' }
    } else {
      outcome = this.options.fcm
        ? await this.options.fcm.send(delivery, { token: device.token })
        : { status: 'error', reason: 'fcm_not_configured' }
    }
    this.options.onOutcome?.(outcome.status)
    if (outcome.status === 'dead') {
      await this.options.devices.markDead(delivery.registrationId, device)
    }
    if (outcome.status !== 'sent') {
      console.warn(
        JSON.stringify({
          event: 'orca_push_delivery_failed',
          platform: device.platform,
          status: outcome.status,
          reason: outcome.reason,
          host: fingerprintLogPrefix(delivery.hostFingerprint)
        })
      )
    }
    if (outcome.status === 'error' && outcome.retryable)
      return { delayMs: outcome.retryAfterMs ?? 0 }
    return undefined
  }
}
