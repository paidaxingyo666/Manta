import { extname } from 'node:path'
import type { NativeChatMessage } from '../../shared/native-chat-types'
import { resolveSessionFilePath } from './session-file-resolver'
import { watchForTranscriptRebind, type RebindWatch } from './transcript-rebind-watch'
import type { NativeChatLineDecoder } from './transcript-tail-reader'
import type {
  NativeChatTranscriptSubscription,
  SubscribeNativeChatTranscriptArgs
} from './transcript-watch-contract'
import { installTranscriptWatcher } from './transcript-watch-engine'

/** One resolve+install attempt. Returns null while the transcript file itself
 *  is unresolved; native-watch failure degrades to reconciliation-only mode. */
export async function attemptInstall(
  args: SubscribeNativeChatTranscriptArgs,
  decode: (line: string, fallbackId: string) => NativeChatMessage | null,
  signal?: AbortSignal
): Promise<NativeChatTranscriptSubscription | null> {
  const filePath =
    args.filePath ?? (await resolveSessionFilePath(args.agent, args.sessionId, args, signal))
  signal?.throwIfAborted()
  if (!filePath) {
    return null
  }
  const installed = await installTranscriptWatcher(filePath, decode, args, signal)
  if (signal?.aborted) {
    installed?.unsubscribe()
    signal.throwIfAborted()
  }
  return installed
}

export function exactTranscriptPath(args: SubscribeNativeChatTranscriptArgs): string | null {
  const path = args.transcriptPath?.trim()
  return path && extname(path) === '.jsonl' ? path : null
}

/**
 * Keeps an already-installed watcher pointed at the session as its file rolls.
 *
 * The resolve-poll path arms the same guard inline, because it already owns a
 * rebind loop. This wraps the case that has none: one install that succeeded, on
 * a path that may stop being the session's before the subscription ends.
 */
export function followRolls(
  installed: NativeChatTranscriptSubscription,
  args: SubscribeNativeChatTranscriptArgs,
  decode: NativeChatLineDecoder
): NativeChatTranscriptSubscription {
  // An explicit filePath is a caller pinning one file on purpose.
  const boundPath = args.filePath ?? exactTranscriptPath(args)
  if (args.filePath || !boundPath) {
    return installed
  }

  let current = installed
  let sessionId = args.sessionId
  let closed = false
  let watch: RebindWatch | null = null
  const controller = new AbortController()

  function arm(path: string): void {
    watch?.stop()
    watch = watchForTranscriptRebind({
      agent: args.agent,
      sessionId,
      boundPath: path,
      signal: controller.signal,
      ...(args.rebindCheckIntervalMs === undefined
        ? {}
        : { intervalMs: args.rebindCheckIntervalMs }),
      onMoved: (next) => {
        if (closed) {
          return
        }
        sessionId = next.sessionId
        args.onRebound?.({ sessionId: next.sessionId, transcriptPath: next.path })
        // Install first, drop second: a failed install must not leave chat with
        // no watcher at all, which is worse than the stale one it replaces.
        void attemptInstall({ ...args, filePath: next.path }, decode, controller.signal)
          .then((replacement) => {
            if (closed) {
              replacement?.unsubscribe()
              return
            }
            if (!replacement) {
              arm(path)
              return
            }
            current.unsubscribe()
            current = replacement
            arm(next.path)
          })
          .catch(() => {
            if (!closed) {
              arm(path)
            }
          })
      }
    })
  }

  arm(boundPath)

  return {
    get watching(): boolean {
      return current.watching
    },
    unsubscribe: () => {
      if (closed) {
        return
      }
      closed = true
      controller.abort()
      watch?.stop()
      watch = null
      current.unsubscribe()
    }
  }
}
