import type { NativeChatMessage } from '../../shared/native-chat-types'
import {
  needsWslHostResolution,
  toHostReadableTranscriptPath,
  type WslTranscriptResolutionSnapshot
} from './host-readable-transcript-path'
import { watchForTranscriptRebind, type RebindWatch } from './transcript-rebind-watch'
import { attemptInstall, exactTranscriptPath, followRolls } from './transcript-watch-binding'
import type {
  NativeChatTranscriptSubscription,
  SubscribeNativeChatTranscriptArgs
} from './transcript-watch-contract'
import { nativeChatLineDecoderForAgent } from './transcript-tail-reader'
import { WslTranscriptFsError, wslTranscriptFsRefusal } from './wsl-transcript-fs-gate'
import { observeRunningWslDistros } from './wsl-transcript-running-observer'

export { readNativeChatTranscriptTail } from './transcript-tail-reader'
export { getActiveNativeChatWatcherCount } from './transcript-watcher-count'
export type {
  NativeChatTranscriptSubscription,
  SubscribeNativeChatTranscriptArgs
} from './transcript-watch-contract'

// Why: Claude Code (and other agents) can take from ~3s to minutes to flush a
// brand-new session's first JSONL line (#8401) — resolveSessionFilePath
// genuinely has nothing to find yet. Poll for it instead of going deaf. Exact
// hook paths are probed on every retry; the recursive
// session-id fallback runs less often because a large Claude tree is expensive.
const INITIAL_RESOLVE_POLL_MS = 500
const MAX_RESOLVE_POLL_MS = 5_000
const FALLBACK_RESOLVE_POLL_MS = 5_000
// Why: with no frame at all a client shows a bare spinner for the whole flush
// delay — a fresh session that has yet to be prompted never flushes, so the
// spinner is permanent. Long enough that a merely slow resolve still wins the
// race and paints history directly.
const UNFLUSHED_SETTLE_MS = 1_500

/**
 * Background retry loop for a transcript that hasn't been resolvable yet.
 * Returns a subscription immediately (per subscribeNativeChatTranscript's
 * contract); the loop keeps retrying resolve+install until it succeeds or
 * unsubscribe() cancels it. Reports watching:true — the engine's first drain
 * delivers the initial snapshot once the file appears, so subscribers must not
 * settle a merely not-yet-flushed transcript into a permanent error (#8401).
 * A short grace period in, it reports the transcript as pending once so the
 * view can stop spinning while it waits.
 */
function subscribeViaResolvePoll(
  args: SubscribeNativeChatTranscriptArgs,
  decode: (line: string, fallbackId: string) => NativeChatMessage | null
): NativeChatTranscriptSubscription {
  let closed = false
  let installed: NativeChatTranscriptSubscription | null = null
  let rebindWatch: RebindWatch | null = null
  /** The session the bound file belongs to; advances each time it rolls. */
  let rebindSessionId = args.sessionId
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let delay = args.resolvePollIntervalMs ?? INITIAL_RESOLVE_POLL_MS
  let lastFallbackResolveAt = Date.now()
  let exactPath = exactTranscriptPath(args)
  let exactPathNeedsWslResolution = exactPath !== null && needsWslHostResolution(exactPath)
  // Why: WSL hooks report guest Linux paths the Windows host cannot open; the
  // UNC twin is resolved lazily (the distro may still be cold) and memoized so
  // the exact-path install doesn't wait on the slower id-glob (#10326).
  let hostReadableExactPath: string | null = null
  // Latches only once a frame was actually emitted, so a subscriber without the
  // callback can't suppress it for a later one.
  let gateErrorEmitted = false
  // Whether the subscriber already has an initial frame to render.
  let settled = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  const resolveController = new AbortController()
  let stopWslObservation = (): void => {}

  function stopSettleTimer(): void {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  /** Report a still-unresolved transcript so the view can leave 'loading' and
   *  invite a first message instead of spinning. Deliberately not a snapshot:
   *  an empty window presented as a settled read would capture over retained
   *  history and unblock consumers that require a trustworthy transcript. */
  function settleUnflushed(): void {
    settleTimer = null
    if (closed || settled || installed || !args.onTranscriptPending) {
      return
    }
    settled = true
    args.onTranscriptPending()
  }

  if (args.onTranscriptPending) {
    settleTimer = setTimeout(settleUnflushed, UNFLUSHED_SETTLE_MS)
    settleTimer.unref?.()
  }

  /**
   * Follow the session if its transcript rolls to a new file.
   *
   * A watcher binds once and then holds that descriptor. When the bound file
   * stops being the one the agent writes, the watcher stays healthy, keeps
   * reporting watching:true, and delivers nothing — indistinguishable from an
   * idle conversation. See transcript-rebind-watch.ts for what that cost.
   */
  function armRebindWatch(boundPath: string | null): void {
    rebindWatch?.stop()
    rebindWatch = null
    // An explicit filePath is a caller pinning one file on purpose.
    if (!boundPath || args.filePath) {
      return
    }
    rebindWatch = watchForTranscriptRebind({
      agent: args.agent,
      sessionId: rebindSessionId,
      boundPath,
      signal: resolveController.signal,
      ...(args.rebindCheckIntervalMs === undefined
        ? {}
        : { intervalMs: args.rebindCheckIntervalMs }),
      onMoved: (next) => {
        if (closed) {
          return
        }
        // Pin the successor rather than re-resolving: the id we hold still
        // resolves to the dead file, which is the whole reason we are here.
        // Track the new id too, so a second roll is still findable.
        rebindSessionId = next.sessionId
        args.onRebound?.({ sessionId: next.sessionId, transcriptPath: next.path })
        installed?.unsubscribe()
        installed = null
        exactPath = next.path
        exactPathNeedsWslResolution = needsWslHostResolution(next.path)
        hostReadableExactPath = null
        delay = args.resolvePollIntervalMs ?? INITIAL_RESOLVE_POLL_MS
        beginResolutionPolling()
      }
    })
  }

  function scheduleAttempt(): void {
    if (closed || exactPathNeedsWslResolution) {
      return
    }
    const untilFallbackResolve = exactPath
      ? Math.max(0, FALLBACK_RESOLVE_POLL_MS - (Date.now() - lastFallbackResolveAt))
      : delay
    pollTimer = setTimeout(
      () => {
        pollTimer = null
        void runAttempt()
      },
      Math.min(delay, untilFallbackResolve)
    )
    // Why: never hold the event loop open (headless `manta serve` shutdown) for
    // a session that may genuinely never resolve.
    pollTimer.unref?.()
    // Only back off in production; a test-supplied interval stays fixed so
    // tests resolve in bounded, predictable time.
    if (args.resolvePollIntervalMs === undefined) {
      delay = Math.min(delay * 2, MAX_RESOLVE_POLL_MS)
    }
  }

  async function runAttempt(wslSnapshot?: WslTranscriptResolutionSnapshot): Promise<void> {
    if (closed || installed) {
      return
    }
    let result: NativeChatTranscriptSubscription | null
    const now = Date.now()
    const fallbackDue = !exactPath || now - lastFallbackResolveAt >= FALLBACK_RESOLVE_POLL_MS
    try {
      if (exactPath && !hostReadableExactPath) {
        if (!exactPathNeedsWslResolution) {
          // Non-WSL paths stay raw: installTranscriptWatcher already handles a
          // not-yet-created file, so don't spend an extra probe per tick.
          hostReadableExactPath = exactPath
        } else if (wslSnapshot) {
          // The raw guest path is never installed on Windows — it would resolve
          // against the current drive (`C:\home\…`) and bind a look-alike file.
          hostReadableExactPath = await toHostReadableTranscriptPath(exactPath, {
            signal: resolveController.signal,
            wslSnapshot
          })
        }
      }
      result = hostReadableExactPath
        ? await attemptInstall(
            { ...args, filePath: hostReadableExactPath },
            decode,
            resolveController.signal
          )
        : null
      if (!result && exactPathNeedsWslResolution) {
        // A distro may stop after resolution; never retry a stale UNC root.
        hostReadableExactPath = null
      }
      if (!result && fallbackDue && !exactPathNeedsWslResolution) {
        lastFallbackResolveAt = now
        result = await attemptInstall(args, decode, resolveController.signal)
      }
    } catch (error) {
      if (exactPathNeedsWslResolution) {
        hostReadableExactPath = null
      }
      // Why: a transient resolve failure (EACCES/EIO during the glob) must not
      // kill the poll loop with an unhandled rejection — retry like a miss. A
      // stalled WSL distro would otherwise poll silently forever, leaving the
      // client at 'loading'; emit its retryable message once and keep polling,
      // so a later tick's real snapshot still replaces it. Narrowed with a bare
      // instanceof, never wslTranscriptFsRefusal — that helper rethrows, and
      // runAttempt is invoked as `void runAttempt()`.
      if (error instanceof WslTranscriptFsError && !gateErrorEmitted && args.onInitialSnapshot) {
        gateErrorEmitted = true
        // Its retryable message outranks the empty settle; don't overwrite it.
        settled = true
        stopSettleTimer()
        args.onInitialSnapshot([], false, 0, error.message)
      }
      result = null
    }
    if (closed) {
      // unsubscribe() ran while this attempt was in flight.
      result?.unsubscribe()
      return
    }
    if (result) {
      installed = result
      stopWslObservation()
      stopWslObservation = () => {}
      stopSettleTimer()
      armRebindWatch(hostReadableExactPath ?? exactPath ?? null)
      return
    }
    scheduleAttempt()
  }

  function beginResolutionPolling(): void {
    stopWslObservation()
    stopWslObservation = () => {}
    if (exactPathNeedsWslResolution) {
      stopWslObservation = observeRunningWslDistros((runningDistros) =>
        runAttempt({ runningDistros: [...runningDistros] })
      )
      return
    }
    scheduleAttempt()
  }

  beginResolutionPolling()

  return {
    watching: true,
    unsubscribe: () => {
      if (closed) {
        return
      }
      closed = true
      resolveController.abort()
      stopWslObservation()
      stopWslObservation = () => {}
      stopSettleTimer()
      rebindWatch?.stop()
      rebindWatch = null
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      installed?.unsubscribe()
      installed = null
    }
  }
}

/**
 * Subscribe to live appends on an agent's transcript file. Returns an
 * unsubscribe fn that tears the watcher down completely.
 *
 * Handles file rotation/replacement: when the file shrinks (a new session id
 * resolved to a smaller/newer file, or the file was truncated), the offset is
 * reset to 0 so the replacement's content is read from the top.
 *
 * When the transcript isn't resolvable yet (a just-created session whose
 * agent hasn't flushed its first JSONL line, #8401), returns the subscription
 * immediately and keeps retrying resolve+install in the background rather
 * than returning a no-op that never recovers.
 */
export async function subscribeNativeChatTranscript(
  args: SubscribeNativeChatTranscriptArgs,
  setupSignal?: AbortSignal
): Promise<NativeChatTranscriptSubscription> {
  setupSignal?.throwIfAborted()
  const decode = nativeChatLineDecoderForAgent(args.agent)
  if (!decode) {
    // Nothing watchable — return a no-op teardown so callers can unconditionally
    // unsubscribe without null-checks.
    return { unsubscribe: () => {}, watching: false }
  }
  // Why: a blank session id (and no explicit file) can never resolve — bail out
  // instead of resolve-polling an unresolvable target forever.
  if (!args.filePath && !args.sessionId.trim()) {
    return { unsubscribe: () => {}, watching: false }
  }

  let installed: NativeChatTranscriptSubscription | null
  try {
    installed = await attemptInstall(args, decode, setupSignal)
  } catch (error) {
    setupSignal?.throwIfAborted()
    // Why: a gate-refused resolve (stalled WSL distro) must degrade to the
    // resolve-poll fallback below, not fail the subscribe outright.
    void wslTranscriptFsRefusal(error) // rethrows anything that is not a gate refusal
    installed = null
  }
  if (installed) {
    // Why not just return it: the path a hook reports usually EXISTS — a rolled
    // session's old file is not deleted, it just stops growing — so this fast
    // path is the one a frozen chat actually takes. Returning the bare
    // subscription leaves it bound there for good.
    return followRolls(installed, args, decode)
  }
  setupSignal?.throwIfAborted()
  return subscribeViaResolvePoll(args, decode)
}
