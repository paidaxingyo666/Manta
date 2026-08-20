/**
 * Boots the real relay stack on a loopback port.
 *
 * Tests go through `createRelay` rather than assembling the pieces themselves,
 * so the rate limiters, the upgrade path, and the shutdown sequence are all
 * exercised exactly as they run in production. A hand-wired test stack is how
 * you end up with a green suite and a relay that has never once been asked to
 * refuse anything.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRelay, type Relay } from '../relay.js'
import type { RelayConfig } from '../config.js'
import { Logger } from '../shared/log.js'

export const TEST_USER = {
  userId: 'user-1',
  profileId: 'profile-1',
  organizationId: '',
  email: 'u@example.com',
  displayName: 'U'
}

export const TEST_SECRET = 'test-secret'

/**
 * The public origin is signed into every host challenge, so it has to be known
 * before the server binds — hence reserving a port rather than listening on 0.
 */
async function reservePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

export function testConfig(port: number, overrides: Partial<RelayConfig> = {}): RelayConfig {
  const base: RelayConfig = {
    port,
    host: '127.0.0.1',
    publicUrl: `http://127.0.0.1:${port}`,
    dataDir: null,
    relayTokenSecret: TEST_SECRET,
    ephemeralSecret: false,
    assignmentEpoch: 1,
    logLevel: 'error',
    trustedProxies: '',
    metricsToken: null,
    tlsCertPath: null,
    expectedClientId: null,
    enrollmentSecret: null,
    user: TEST_USER,
    sessionTtlMs: 60_000,
    relayTokenTtlMs: 60_000,
    leaseTtlMs: 60_000,
    resumeTtlMs: 60_000,
    graceTtlMs: 60_000,
    attachDeadlineMs: 5_000,
    maxInviteAttempts: 5,
    maxDevicesPerHost: 8,
    maxLiveInvitesPerHost: 32,
    maxLedgerEntriesPerHost: 512,
    maxSessions: 64,
    maxConnsPerHost: 8,
    limits: {
      // Generous by default so ordinary tests are not throttled; the limiter
      // tests tighten these deliberately.
      phoneBurst: 1_000,
      phonePerSecond: 100,
      httpBurst: 1_000,
      httpPerSecond: 100,
      authBurst: 1_000,
      authPerSecond: 100,
      controlBurst: 1_000,
      controlPerSecond: 100
    },
    shutdownGraceMs: 50
  }
  return { ...base, ...overrides, limits: { ...base.limits, ...overrides.limits } }
}

export type TestRelay = {
  relay: Relay
  origin: string
  wsOrigin: string
  config: RelayConfig
  stop: () => Promise<void>
}

/**
 * Restarts on the same port and data directory.
 *
 * Restart is where "persisted" is either true or a comforting lie, so it needs
 * to be exercised against the real snapshot on disk rather than a re-read of
 * in-process state.
 */
export async function restartTestRelay(previous: TestRelay): Promise<TestRelay> {
  await previous.stop()
  const relay = createRelay(previous.config, new Logger(previous.config.logLevel))
  await relay.listen()
  return { ...previous, relay, stop: () => relay.shutdown('test') }
}

export async function startTestRelay(
  overrides: (port: number) => Partial<RelayConfig> = () => ({})
): Promise<TestRelay> {
  const port = await reservePort()
  const config = testConfig(port, overrides(port))
  const relay = createRelay(config, new Logger(config.logLevel))
  await relay.listen()
  const origin = config.publicUrl
  return {
    relay,
    origin,
    wsOrigin: origin.replace(/^http/, 'ws'),
    config,
    stop: () => relay.shutdown('test')
  }
}
