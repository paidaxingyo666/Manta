/** Runtime configuration, entirely from environment variables. */
import { randomBytes } from 'node:crypto'
import { isLogLevel, type LogLevel } from './shared/log.js'
import { parseTrustedProxies } from './shared/client-ip.js'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

/**
 * A positive number from the environment.
 *
 * Silently falling back to the default on a bad value is how `PORT=70000` or a
 * fractional epoch reaches production looking like it was accepted. If it was
 * set, it has to be usable.
 */
function number(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid relay configuration:\n  - ${name} must be a positive number`)
  }
  return parsed
}

function text(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

export type RelayConfig = ReturnType<typeof loadConfig>

/**
 * Rejects values the clients would refuse at runtime.
 *
 * Out-of-range settings do not fail loudly on the wire — the client's strict
 * schema simply drops the whole message — so they are caught at startup.
 */
function assertRanges(config: {
  attachDeadlineMs: number
  maxInviteAttempts: number
  resumeTtlMs: number
  graceTtlMs: number
  maxDevicesPerHost: number
  maxConnsPerHost: number
  maxSessions: number
  shutdownGraceMs: number
  port: number
  assignmentEpoch: number
  publicUrl: string
  logLevel: string
  enrollmentSecret: string | null
}): void {
  const problems: string[] = []
  if (config.attachDeadlineMs < 1 || config.attachDeadlineMs > 60_000) {
    problems.push('MANTA_RELAY_ATTACH_DEADLINE_MS must be between 1 and 60000')
  }
  if (config.maxInviteAttempts < 1 || config.maxInviteAttempts > 16) {
    problems.push('MANTA_RELAY_MAX_INVITE_ATTEMPTS must be between 1 and 16')
  }
  // The phone starts rotating 7 days before expiry, so both windows must be
  // comfortably longer than that or credentials lapse mid-rotation.
  const week = 7 * 24 * 60 * 60_000
  if (config.resumeTtlMs <= week * 2) {
    problems.push('MANTA_RELAY_RESUME_TTL_MS must exceed 14 days')
  }
  if (config.graceTtlMs <= week) {
    problems.push('MANTA_RELAY_GRACE_TTL_MS must exceed 7 days')
  }
  if (config.maxDevicesPerHost < 1 || config.maxDevicesPerHost > 512) {
    problems.push('MANTA_RELAY_MAX_DEVICES must be between 1 and 512')
  }
  if (config.port > 65_535 || !Number.isInteger(config.port)) {
    problems.push('PORT must be an integer between 1 and 65535')
  }
  if (!Number.isInteger(config.assignmentEpoch)) {
    problems.push('MANTA_RELAY_ASSIGNMENT_EPOCH must be an integer')
  }
  if (config.maxSessions < 1) {
    problems.push('MANTA_RELAY_MAX_SESSIONS must be at least 1')
  }
  if (config.maxConnsPerHost < 1 || config.maxConnsPerHost > 8) {
    problems.push('MANTA_RELAY_MAX_CONNS_PER_HOST must be between 1 and 8')
  }
  // The drain frame carries graceMs, and the client refuses anything past an
  // hour — a longer window would make the message itself unparseable.
  if (config.shutdownGraceMs > 60 * 60_000) {
    problems.push('MANTA_RELAY_SHUTDOWN_GRACE_MS must not exceed 3600000')
  }
  if (!isLogLevel(config.logLevel)) {
    problems.push('MANTA_RELAY_LOG_LEVEL must be one of debug, info, warn, error')
  }
  let loopback = false
  try {
    const url = new URL(config.publicUrl)
    if (url.origin !== config.publicUrl) {
      problems.push('MANTA_RELAY_PUBLIC_URL must be a bare origin, without a path')
    }
    loopback =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  } catch {
    problems.push('MANTA_RELAY_PUBLIC_URL is not a valid URL')
  }
  // Without a secret, /authorize hands a session to anyone who can reach the
  // port. Optional on loopback, where that is only the local user; mandatory
  // anywhere else, so an open enrolment endpoint cannot be deployed by accident.
  if (!loopback && !config.enrollmentSecret) {
    problems.push(
      'MANTA_RELAY_ENROLLMENT_SECRET is required unless MANTA_RELAY_PUBLIC_URL is loopback; ' +
        'generate one with: openssl rand -base64 24'
    )
  }
  if (problems.length > 0) {
    throw new Error(`invalid relay configuration:\n  - ${problems.join('\n  - ')}`)
  }
}

/** Parses the proxy list here so a typo fails at startup, not on first request. */
function assertTrustedProxies(spec: string): void {
  try {
    parseTrustedProxies(spec)
  } catch (error) {
    throw new Error(`invalid relay configuration:\n  - ${(error as Error).message}`)
  }
}

export function loadConfig() {
  // PUBLIC_URL is the origin clients reach; it is signed into every host
  // challenge, so it must match exactly what the desktop connected to.
  const publicUrl = required('MANTA_RELAY_PUBLIC_URL').replace(/\/$/, '')
  const secret = process.env.MANTA_RELAY_TOKEN_SECRET?.trim()
  const logLevel = text('MANTA_RELAY_LOG_LEVEL', 'info')
  const config = {
    port: number('PORT', 8787),
    // Not a range check on a preference: an out-of-range port simply cannot be
    // bound, and the failure would arrive as an opaque listen error.
    host: text('HOST', '0.0.0.0'),
    publicUrl,
    dataDir: process.env.MANTA_RELAY_DATA_DIR?.trim() || null,
    relayTokenSecret: secret || randomBytes(32).toString('base64url'),
    /** True when the secret is ephemeral, so startup can say so loudly. */
    ephemeralSecret: !secret,
    assignmentEpoch: number('MANTA_RELAY_ASSIGNMENT_EPOCH', 1),
    logLevel: logLevel as LogLevel,
    /**
     * Addresses allowed to set X-Forwarded-For. Empty means "trust nobody",
     * which is right for a directly exposed relay and wrong behind a proxy —
     * there every client would share the proxy's rate-limit bucket.
     */
    trustedProxies: text('MANTA_RELAY_TRUSTED_PROXIES', ''),
    /** Guards /metrics. Without it the endpoint is not served at all. */
    metricsToken: process.env.MANTA_RELAY_METRICS_TOKEN?.trim() || null,
    /**
     * Certificate the reverse proxy serves, if the relay should watch its
     * expiry. Only worth setting where renewal is not automatic.
     */
    tlsCertPath: process.env.MANTA_RELAY_TLS_CERT_PATH?.trim() || null,
    /** Rejects an authorize call from an unexpected client build when set. */
    expectedClientId: process.env.MANTA_RELAY_CLIENT_ID?.trim() || null,
    /** Required to enrol a desktop; mandatory on a non-loopback origin. */
    enrollmentSecret: process.env.MANTA_RELAY_ENROLLMENT_SECRET?.trim() || null,
    user: {
      userId: text('MANTA_RELAY_USER_ID', 'self-hosted-user'),
      profileId: text('MANTA_RELAY_PROFILE_ID', 'self-hosted-profile'),
      // Must stay empty unless the desktop profile really has an organization:
      // the value is compared byte-for-byte inside the host proof.
      organizationId: process.env.MANTA_RELAY_ORG_ID?.trim() || '',
      email: text('MANTA_RELAY_USER_EMAIL', 'user@self-hosted.local'),
      displayName: text('MANTA_RELAY_USER_NAME', 'Self-hosted user')
    },
    sessionTtlMs: number('MANTA_RELAY_SESSION_TTL_MS', 30 * 24 * 60 * 60_000),
    relayTokenTtlMs: number('MANTA_RELAY_TOKEN_TTL_MS', 60 * 60_000),
    leaseTtlMs: number('MANTA_RELAY_LEASE_TTL_MS', 10 * 60_000),
    // Resume credentials drive the phone's 7-day rotation window, so the grace
    // period must comfortably outlast it.
    resumeTtlMs: number('MANTA_RELAY_RESUME_TTL_MS', 90 * 24 * 60 * 60_000),
    graceTtlMs: number('MANTA_RELAY_GRACE_TTL_MS', 30 * 24 * 60 * 60_000),
    attachDeadlineMs: number('MANTA_RELAY_ATTACH_DEADLINE_MS', 10_000),
    maxInviteAttempts: number('MANTA_RELAY_MAX_INVITE_ATTEMPTS', 5),
    maxDevicesPerHost: number('MANTA_RELAY_MAX_DEVICES', 16),
    maxLiveInvitesPerHost: number('MANTA_RELAY_MAX_LIVE_INVITES', 32),
    maxLedgerEntriesPerHost: number('MANTA_RELAY_MAX_LEDGER_ENTRIES', 512),
    maxSessions: number('MANTA_RELAY_MAX_SESSIONS', 64),
    // The desktop's host-hello-ack schema caps activeConnIds and pendingConns
    // at 8 each, so this can never exceed 8 without breaking every rebind.
    maxConnsPerHost: number('MANTA_RELAY_MAX_CONNS_PER_HOST', 8),
    /**
     * Rate limits. Defaults are sized for a household, not a public service:
     * a phone reconnecting after a network flap needs a burst of a few, and
     * nothing legitimate needs a sustained stream.
     */
    limits: {
      phoneBurst: number('MANTA_RELAY_PHONE_BURST', 20),
      phonePerSecond: number('MANTA_RELAY_PHONE_RATE', 1),
      httpBurst: number('MANTA_RELAY_HTTP_BURST', 60),
      httpPerSecond: number('MANTA_RELAY_HTTP_RATE', 5),
      authBurst: number('MANTA_RELAY_AUTH_BURST', 20),
      authPerSecond: number('MANTA_RELAY_AUTH_RATE', 0.5),
      controlBurst: number('MANTA_RELAY_CONTROL_BURST', 60),
      controlPerSecond: number('MANTA_RELAY_CONTROL_RATE', 5)
    },
    /** How long connected peers get to migrate before the process exits. */
    shutdownGraceMs: number('MANTA_RELAY_SHUTDOWN_GRACE_MS', 5_000)
  }
  assertRanges({ ...config, logLevel })
  assertTrustedProxies(config.trustedProxies)
  return config
}
