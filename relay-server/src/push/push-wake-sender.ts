import { loadApnsConfig } from './apns-config.js'
import { ApnsSender } from './apns-sender.js'
import type { PushWakeSender } from '../cell/control-requests.js'

type Logger = { info: (event: string, fields?: Record<string, unknown>) => void }

/**
 * Builds the push path, or reports that the operator did not ask for one.
 *
 * Configuration errors throw rather than degrade: the relay fails to boot beside
 * the rest of its settings instead of running for hours and dropping the first
 * notification silently.
 */
export function createPushWakeSender(logger: Logger): PushWakeSender | null {
  const config = loadApnsConfig()
  if (!config) {
    logger.info('apns.disabled', { reason: 'not configured' })
    return null
  }
  const sender = new ApnsSender(config.credentials, config.topic, config.host)
  logger.info('apns.ready', {
    topic: config.topic,
    // The host, not the key: enough to tell production from sandbox in a log,
    // and nothing an attacker gains from.
    endpoint: config.host,
    keyId: config.credentials.keyId
  })
  return async (input) => {
    const result = await sender.send(input)
    return result.ok
      ? { ok: true, discardToken: false }
      : { ok: false, discardToken: result.discardToken, reason: result.reason }
  }
}
