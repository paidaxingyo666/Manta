type MantaCloudSessionInvalidationListener = () => void

const listeners = new Set<MantaCloudSessionInvalidationListener>()

/**
 * Fires when an auth failure (revoked or rotated-away refresh token) clears a
 * stored cloud session. Never fires for an explicit user sign-out, which already
 * hands the fresh auth status back to its caller.
 */
export function onOrcaCloudSessionInvalidated(
  listener: MantaCloudSessionInvalidationListener
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitOrcaCloudSessionInvalidated(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn(
        '[manta-profiles] Cloud session invalidation listener failed:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
