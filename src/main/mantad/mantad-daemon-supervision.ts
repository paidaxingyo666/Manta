/**
 * mantad's half of the supervision contract: it spawns and supervises the terminal daemon.
 *
 * The whole reason the peer model is recommended over an SSH target is that daemon-backed
 * PTYs stay `live` across a runtime restart (docs/reference/ssh-execution-boundary.md).
 * Without a daemon here, every mantad restart, update and rollback is a SIGKILL for every
 * running terminal — on the host whose selling point is that work survives the client going
 * away.
 *
 * The constraint that makes a restart non-destructive lives in `stopMantadDaemon` below: the
 * daemon is DETACHED and must outlive this process. Anything that tears it down on the way
 * out silently converts a restart back into data loss.
 */
import {
  disconnectDaemon,
  daemonOwnsFreshPersistentPtys,
  initDaemonPtyProvider,
  readDaemonPidRecord
} from '../daemon/daemon-init'

export type OrcadDaemonStartup =
  | { state: 'live'; pid: number | null }
  | { state: 'degraded'; reason: string }
  | { state: 'unavailable'; reason: string }

/**
 * Bring the daemon up and install it as the local PTY provider.
 *
 * Fail-open, like the desktop: a host that cannot start a daemon must still serve git,
 * worktrees and non-persistent terminals. What it must NOT do is keep claiming persistence
 * — `daemonOwnsFreshPersistentPtys()` is what the runtime reads for that, and it answers
 * false here without any extra bookkeeping.
 */
export async function startMantadDaemon(): Promise<OrcadDaemonStartup> {
  try {
    // Why no login-session watch: that retires the daemon when the spawning macOS GUI login
    // session dies. An mantad daemon must survive its SSH session ending — that is the point.
    await initDaemonPtyProvider(undefined, { macosLoginSessionWatch: false })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(
      `[mantad] The terminal daemon did not start: ${reason}\n` +
        '[mantad] Terminals will run in-process and WILL NOT survive an mantad restart.'
    )
    return { state: 'unavailable', reason }
  }
  if (!daemonOwnsFreshPersistentPtys()) {
    const reason = 'daemon adopted in degraded mode; fresh terminals run on the local provider'
    console.warn(
      `[mantad] ${reason}. Existing daemon sessions keep working, but new terminals will not ` +
        'survive an mantad restart until the daemon is restarted.'
    )
    return { state: 'degraded', reason }
  }
  return { state: 'live', pid: readDaemonPidRecord()?.pid ?? null }
}

/**
 * Release the daemon without killing it.
 *
 * Why `disconnectDaemon` and never `shutdownDaemon`: shutdown kills the daemon process and
 * every PTY under it. Calling it here would make mantad's own restart destructive, which is
 * the exact property this whole item exists to buy.
 */
export async function stopMantadDaemon(): Promise<void> {
  await disconnectDaemon()
}
