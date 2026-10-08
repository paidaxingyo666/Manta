/**
 * The desktop app takes mantad's instance lock on its userData profile, so `manta serve` on
 * mantad and the desktop refuse each other instead of both writing one profile.
 *
 * Electron's single-instance lock only fences other Electron launches; mantad is a plain Node
 * process that cannot see it. Sharing mantad's lock file gives both hosts one owner record.
 */
import {
  acquireMantadInstanceLock,
  MantadInstanceLockError,
  type MantadInstanceLock
} from '../mantad/mantad-instance-lock'
import { writeStartupDiagnosticLine, type StartupDiagnosticSink } from './startup-diagnostics'

export type DesktopProfileLockResult =
  | { state: 'acquired'; lock: MantadInstanceLock }
  | { state: 'held'; message: string }
  /** The lock could not be taken for another reason; the desktop starts as it did before it. */
  | { state: 'unavailable' }

export function acquireDesktopProfileInstanceLock(
  userDataPath: string,
  acquire: typeof acquireMantadInstanceLock = acquireMantadInstanceLock,
  write?: StartupDiagnosticSink
): DesktopProfileLockResult {
  try {
    const lock = acquire(userDataPath, { role: 'desktop' })
    // Best effort: a lock left by a dead pid is reclaimed on the next start anyway.
    process.once('exit', () => lock.release())
    return { state: 'acquired', lock }
  } catch (error) {
    if (error instanceof MantadInstanceLockError && error.code === 'orcad_instance_lock_held') {
      writeStartupDiagnosticLine(`[single-instance] ${error.message}`, write)
      return { state: 'held', message: error.message }
    }
    // Why not refuse: only a proven live holder may stop a desktop that never took this lock before.
    console.warn('[single-instance] Could not take the shared profile lock:', error)
    return { state: 'unavailable' }
  }
}
