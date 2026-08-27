import { stat } from 'node:fs/promises'
import { findSuccessorTranscript, type TranscriptSuccessor } from './claude-transcript-successor'
import type { AgentType } from '../../shared/native-chat-types'

/**
 * How often to ask whether this session's transcript still lives where the
 * watcher bound to it.
 *
 * Slow on purpose: the answer changes only when the agent rolls to a new file,
 * and chat is not waiting on it — the installed watcher keeps delivering the
 * whole time. This trades latency on a rare event for near-zero cost on the
 * common one.
 */
const REBIND_CHECK_INTERVAL_MS = 30_000
/** Only look for a successor once the bound file has gone this long unwritten. */
const QUIET_BEFORE_SEARCH_MS = 120_000

export type RebindWatch = { stop: () => void }

/** setTimeout's handle differs between the DOM and Node lib types. */
type RebindTimer = ReturnType<typeof setTimeout>

type Args = {
  agent: AgentType
  /** The session id the bound file belongs to. */
  sessionId: string
  /** The path the live watcher is bound to. */
  boundPath: string
  /** Called with the file and id the session continued into. */
  onMoved: (next: TranscriptSuccessor) => void
  signal?: AbortSignal
  intervalMs?: number
  quietBeforeSearchMs?: number
  setTimer?: (fn: () => void, ms: number) => RebindTimer
  clearTimer?: (timer: RebindTimer) => void
  findSuccessor?: typeof findSuccessorTranscript
  mtimeMs?: (path: string) => Promise<number>
  now?: () => number
}

/**
 * Notices when a watched transcript stops being the session's transcript.
 *
 * A watcher binds to a path once and holds that descriptor for the life of the
 * subscription. That is right until the file stops being the one the agent
 * writes — then the watcher stays healthy, reports `watching: true`, and
 * delivers nothing, which is indistinguishable from an idle conversation. One
 * such bind sat unnoticed for seven hours: the chat list stopped at the dead
 * file's last message, push notifications kept re-announcing that same message
 * because they read the same transcript, and messages sent from the phone never
 * echoed back because the echo retires by finding its text in the transcript.
 *
 * The trigger is a POSITIVE STATEMENT OF DESCENT — a newer sibling that replays
 * our rows under our session id — never a quiet file. Quiet is only a cheap
 * pre-filter: an idle session is quiet too, but it has no successor, so it never
 * rebinds. See claude-transcript-successor.ts for why the resolver cannot answer
 * this (the old file still exists at exactly `<old-id>.jsonl`).
 *
 * A failed search leaves the current watcher alone. The file it holds is the
 * best answer available, and dropping a live binding because one probe raced a
 * rename would turn a transient into an outage.
 */
export function watchForTranscriptRebind(args: Args): RebindWatch {
  const {
    agent,
    sessionId,
    boundPath,
    onMoved,
    signal,
    intervalMs = REBIND_CHECK_INTERVAL_MS,
    quietBeforeSearchMs = QUIET_BEFORE_SEARCH_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms) as RebindTimer,
    clearTimer = (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
    findSuccessor = findSuccessorTranscript,
    mtimeMs = async (path: string) => (await stat(path)).mtimeMs,
    now = Date.now
  } = args

  let stopped = false
  let timer: RebindTimer | null = null

  function stop(): void {
    if (stopped) {
      return
    }
    stopped = true
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  function schedule(): void {
    if (stopped || signal?.aborted) {
      return
    }
    timer = setTimer(() => {
      timer = null
      void check()
    }, intervalMs)
  }

  async function check(): Promise<void> {
    if (stopped || signal?.aborted) {
      return
    }
    try {
      const quietFor = now() - (await mtimeMs(boundPath))
      if (quietFor >= quietBeforeSearchMs) {
        const next = await findSuccessorTranscriptSafely()
        if (next && next.path !== boundPath) {
          if (!stopped && !signal?.aborted) {
            onMoved(next)
          }
          return
        }
      }
    } catch {
      // Why swallow: a probe can fail transiently (a stalled WSL distro, an
      // EACCES mid-scan). The bound watcher is still the best available answer.
    }
    schedule()
  }

  async function findSuccessorTranscriptSafely(): Promise<TranscriptSuccessor | null> {
    // Only Claude rolls a session into a new file this way; the other agents
    // keep appending, so searching their roots would only find strangers.
    if (agent !== 'claude') {
      return null
    }
    return findSuccessor(
      signal === undefined ? { boundPath, sessionId } : { boundPath, sessionId, signal }
    )
  }

  schedule()
  return { stop }
}
