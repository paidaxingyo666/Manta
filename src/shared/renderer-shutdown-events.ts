export const MANTA_RENDERER_UNLOAD_PREVENTED_EVENT = 'manta:renderer-unload-prevented'
export const MANTA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT =
  'manta:renderer-shutdown-checkpoint-failed'
export const MANTA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT =
  'manta:renderer-shutdown-checkpoint-aborted'

// Why a DOM attribute: the checkpoint guard runs in the renderer's main world while
// prepareRendererForAppRestart runs in the context-isolated preload world. Events
// cross worlds but their JS payloads don't; document attributes are shared platform
// state, so this is the one channel that carries the failure reason to the thrower.
export const MANTA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE =
  'data-manta-shutdown-checkpoint-failure'

export function formatShutdownCheckpointFailureReason(error: unknown): string {
  try {
    const reason = String(error instanceof Error ? error.message : error)
    return reason || 'Unknown shutdown checkpoint failure'
  } catch {
    return 'Unknown shutdown checkpoint failure'
  }
}

export function publishShutdownCheckpointFailureReason(reason: string): void {
  try {
    globalThis.document?.documentElement?.setAttribute(
      MANTA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE,
      reason
    )
  } catch {
    // Best-effort diagnostics; the checkpoint verdict itself is carried by the event.
  }
}

export function clearShutdownCheckpointFailureReason(): void {
  try {
    globalThis.document?.documentElement?.removeAttribute(
      MANTA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE
    )
  } catch {
    // Best-effort diagnostics only.
  }
}

/** Read and clear the published reason so a stale one can't label a later failure. */
export function consumeShutdownCheckpointFailureReason(): string | null {
  try {
    const root = globalThis.document?.documentElement
    const reason = root?.getAttribute(MANTA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE)
    if (reason) {
      root?.removeAttribute(MANTA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE)
    }
    return reason || null
  } catch {
    return null
  }
}
