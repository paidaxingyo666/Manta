/**
 * The identity envelopes the desktop expects.
 *
 * Kept apart from request handling because the exact shape is load-bearing:
 * the client reads `response.capabilities` and `response.cloud`, and a flat
 * body normalizes to `{flags:{}}` — which is then persisted, silently revoking
 * relay.use and taking the relay offline until the user signs in again.
 */
import type { AuthUser } from './auth-options.js'

export function sessionBody(
  user: AuthUser,
  tokens: {
    accessToken: string
    refreshToken: string
    expiresAt: number
  }
): Record<string, unknown> {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    cloud: {
      cloudProfileId: user.profileId,
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      ...(user.organizationId ? { activeOrgId: user.organizationId } : {})
    },
    organizations: user.organizationId
      ? [{ orgId: user.organizationId, name: user.organizationId, role: 'owner' }]
      : [],
    // Without relay.use the desktop never opens a relay broker at all.
    capabilities: { flags: { 'relay.use': true }, refreshedAt: Date.now() }
  }
}

/** The identity envelope, without minting a new session. */
export function identityBody(user: AuthUser): Record<string, unknown> {
  const body = sessionBody(user, { accessToken: '', refreshToken: '', expiresAt: 0 })
  return { cloud: body.cloud, organizations: body.organizations, capabilities: body.capabilities }
}
