/**
 * Builds the artifact surface, or nothing at all.
 *
 * A factory rather than two constructor calls in the composition root, because
 * "nothing at all" is the normal case: every deployment that has not asked for
 * artifacts gets a null here, and the relay behaves exactly as it did before
 * the feature existed. Keeping that branch in one place is what makes it easy
 * to see that the off path allocates nothing and serves nothing.
 */
import type { IncomingMessage } from 'node:http'
import type { RelayConfig } from '../config.js'
import type { AuthSessionStore } from '../auth/store.js'
import type { Logger } from '../shared/log.js'
import type { Metrics } from '../metrics.js'
import type { RateLimiter } from '../shared/rate-limit.js'
import { ArtifactServer } from './server.js'
import { ArtifactStore } from './store.js'

export type ArtifactSurface = {
  store: ArtifactStore
  server: ArtifactServer
}

export function createArtifactSurface(
  config: RelayConfig,
  deps: {
    sessions: AuthSessionStore
    logger: Logger
    metrics: Metrics
    limiter: RateLimiter
  }
): ArtifactSurface | null {
  if (!config.artifacts.enabled) {
    return null
  }
  const store = new ArtifactStore(
    config.dataDir,
    (error) => deps.logger.error('artifacts.persist_failed', { error }),
    {
      maxPerAccount: config.artifacts.maxPerAccount,
      maxTotalBytesPerAccount: config.artifacts.maxTotalBytesPerAccount
    },
    config.relayTokenSecret
  )
  const server = new ArtifactServer({
    store,
    // The same sessions the auth server mints: an artifact host that verified
    // its own credential would be a second identity system for one deployment.
    sessions: deps.sessions,
    publicUrl: config.artifacts.publicUrl,
    maxBytes: config.artifacts.maxBytes,
    ttlMs: config.artifacts.ttlMs,
    logger: deps.logger,
    metrics: deps.metrics,
    limiter: deps.limiter
  })
  return { store, server }
}

/**
 * True when this request came in on the artifact origin, and so must be served
 * artifact routes and nothing else.
 *
 * That origin serves pages written by whoever published them, so auth and cell
 * endpoints reachable there would be same-origin with hostile content — the
 * thing the separate origin exists to stop. The proxy is supposed to enforce
 * it; a proxy is a config file, and one written too loosely should be a
 * mistake rather than a breach.
 *
 * Compared on host, which is what a browser sends and what the proxy passes
 * through. An unset artifact origin matches nothing, so a deployment without
 * the feature is unaffected.
 */
export function isArtifactHost(request: IncomingMessage, artifactPublicUrl: string): boolean {
  if (!artifactPublicUrl) {
    return false
  }
  const host = request.headers.host
  if (!host) {
    return false
  }
  try {
    return host.toLowerCase() === new URL(artifactPublicUrl).host.toLowerCase()
  } catch {
    return false
  }
}

/**
 * Artifact gauges, or nothing when the feature is off.
 *
 * The byte total matters as much as the count: the operator's disk is what is
 * at stake, and a hundred small notes and a hundred ten-megabyte pages are the
 * same number.
 */
export function recordArtifactGauges(metrics: Metrics, store: ArtifactStore | null): void {
  if (!store) {
    return
  }
  metrics.gauge('manta_relay_artifacts', 'Stored artifacts.', store.size)
  metrics.gauge('manta_relay_artifact_bytes', 'Bytes of artifact content held.', store.totalBytes)
}
