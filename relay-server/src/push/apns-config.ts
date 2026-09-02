import { readFileSync } from 'node:fs'
import { APNS_PRODUCTION_HOST, APNS_SANDBOX_HOST } from './apns-sender.js'
import type { ApnsCredentials } from './apns-provider-token.js'

/**
 * Reads the APNs settings, or decides there are none.
 *
 * Push is opt-in: a relay with none of these set simply does not offer it, and
 * the mobile app falls back to the reconnect catch-up it already does. But a
 * relay with SOME of them set is a mistake, not a choice — silently running
 * without push because one variable was misspelled is how an operator spends an
 * afternoon wondering why their phone is quiet.
 *
 * Why the key is a path and not its contents: a value in the environment shows
 * up in `docker inspect`, in /proc/<pid>/environ, and in any crash report that
 * dumps env. This one is a private key that can push arbitrary notifications to
 * every install of the app, so it stays a file, mounted read-only, exactly like
 * the TLS certificate beside it.
 */

const VARS = {
  keyPath: 'MANTA_RELAY_APNS_KEY_PATH',
  keyId: 'MANTA_RELAY_APNS_KEY_ID',
  teamId: 'MANTA_RELAY_APNS_TEAM_ID',
  topic: 'MANTA_RELAY_APNS_TOPIC',
  environment: 'MANTA_RELAY_APNS_ENVIRONMENT'
} as const

export type ApnsConfig = {
  credentials: ApnsCredentials
  topic: string
  host: string
}

/** A 10-character Apple identifier — Key IDs and Team IDs share the shape. */
const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/

export function loadApnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const read = (name: string): string | null => env[name]?.trim() || null
  const values = {
    keyPath: read(VARS.keyPath),
    keyId: read(VARS.keyId),
    teamId: read(VARS.teamId),
    topic: read(VARS.topic)
  }
  const provided = Object.entries(values).filter(([, value]) => value !== null)
  if (provided.length === 0) {
    return null
  }
  const missing = Object.entries(values)
    .filter(([, value]) => value === null)
    .map(([key]) => VARS[key as keyof typeof values])
  if (missing.length > 0) {
    throw new Error(
      `APNs push is partially configured: set ${missing.join(', ')}, or unset all of them to disable push`
    )
  }

  for (const [label, value] of [
    [VARS.keyId, values.keyId],
    [VARS.teamId, values.teamId]
  ] as const) {
    if (!APPLE_ID_PATTERN.test(value!)) {
      throw new Error(`${label} must be 10 uppercase letters and digits, got "${value}"`)
    }
  }

  let privateKey: string
  try {
    privateKey = readFileSync(values.keyPath!, 'utf8')
  } catch (error) {
    // Why name the uid: the container runs as a non-root user, so a key that is
    // readable on the host is routinely unreadable through the bind mount. That
    // is the failure this message exists for.
    throw new Error(
      `Cannot read ${VARS.keyPath} at ${values.keyPath} (${String(error)}). ` +
        `The relay runs as a non-root user; the file must be readable by it through the mount.`
    )
  }
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error(`${values.keyPath} is not a PEM private key — expected the .p8 from Apple`)
  }

  const environment = read(VARS.environment) ?? 'production'
  if (environment !== 'production' && environment !== 'sandbox') {
    throw new Error(`${VARS.environment} must be "production" or "sandbox", got "${environment}"`)
  }

  return {
    credentials: { privateKey, keyId: values.keyId!, teamId: values.teamId! },
    topic: values.topic!,
    // Why production is the default: TestFlight and the App Store both use it.
    // Only a build side-loaded from Xcode talks to sandbox, and defaulting there
    // would mean push silently works in development and never in the field.
    host: environment === 'sandbox' ? APNS_SANDBOX_HOST : APNS_PRODUCTION_HOST
  }
}
