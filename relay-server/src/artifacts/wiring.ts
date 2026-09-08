/**
 * Builds the artifact surface, or nothing at all.
 *
 * A factory rather than two constructor calls in the composition root, because
 * "nothing at all" is the normal case: every deployment that has not asked for
 * artifacts gets a null here, and the relay behaves exactly as it did before
 * the feature existed. Keeping that branch in one place is what makes it easy
 * to see that the off path allocates nothing and serves nothing.
 */
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
