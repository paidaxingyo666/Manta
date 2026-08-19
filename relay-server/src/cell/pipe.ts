/**
 * One direction of a phone-desktop pair.
 *
 * Split out of the session because backpressure is a self-contained concern
 * with its own state machine, and because E2EE v2 makes the naive answer wrong:
 * a slow consumer cannot be handled by dropping frames, since the counter
 * admits no gap. The only correct options are to pause the producer or to tear
 * the pair down.
 */
import type { WebSocket } from 'ws'

/**
 * Backpressure ceiling per direction.
 *
 * E2EE v2 admits no gap, so a slow consumer cannot be handled by dropping
 * frames — the only correct options are to pause the producer or to tear the
 * pair down. We pause first and only close if the peer stays stuck.
 */
const MAX_OUTBOUND_BUFFER_BYTES = 8 * 1024 * 1024
const BACKPRESSURE_POLL_MS = 50
/**
 * How long a peer may stay above the high-water mark before the pair is cut.
 *
 * A byte ceiling alone cannot work here: once the producer is paused the
 * consumer's buffer only shrinks, so it never reaches any larger threshold and
 * a permanently wedged socket would hold its 8MB and its timer forever. Time is
 * the only thing that still moves.
 */
const BACKPRESSURE_STALL_MS = 30_000

/**
 * One direction of a pair, with its own pause state.
 *
 * The state has to live here rather than in a per-frame closure: `pause()` on a
 * socket is a flag, not a counter, so one frame's resume timer would otherwise
 * un-pause a socket another frame still needs held.
 */
export class Pipe {
  private paused = false
  private pausedAt = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly from: WebSocket,
    private readonly to: WebSocket,
    private readonly onOverflow: () => void,
    private readonly onBytes?: (bytes: number) => void
  ) {}

  push(data: Buffer, isBinary: boolean): void {
    if (this.to.readyState !== this.to.OPEN) {
      return
    }
    this.to.send(data, { binary: isBinary })
    this.onBytes?.(data.byteLength)
    if (this.paused || this.to.bufferedAmount <= MAX_OUTBOUND_BUFFER_BYTES) {
      return
    }
    this.paused = true
    this.pausedAt = Date.now()
    this.from.pause()
    this.timer = setInterval(() => this.poll(), BACKPRESSURE_POLL_MS)
    this.timer.unref?.()
  }

  private poll(): void {
    if (this.to.readyState !== this.to.OPEN || this.from.readyState !== this.from.OPEN) {
      this.stop()
      return
    }
    if (this.to.bufferedAmount <= MAX_OUTBOUND_BUFFER_BYTES / 2) {
      this.stop()
      return
    }
    if (Date.now() - this.pausedAt >= BACKPRESSURE_STALL_MS) {
      // Give up rather than hold the pair open forever; the peer reconnects and
      // rebuilds a fresh E2EE session, which is the recovery 4408 asks for.
      this.stop()
      this.onOverflow()
    }
  }

  /** Idempotent: safe to call from the timer and from either socket's close. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.paused) {
      this.paused = false
      try {
        this.from.resume()
      } catch {
        // The socket may already be destroyed; nothing to resume.
      }
    }
  }
}
