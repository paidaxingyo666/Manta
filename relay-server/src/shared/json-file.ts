/**
 * Durable JSON snapshots.
 *
 * Both the credential store and the auth session store need the same thing: a
 * small document that must survive a restart and must never be observed
 * half-written. The write is staged to a sibling temp file and renamed, which
 * is atomic within a directory on POSIX, and the directory is fsynced so the
 * rename itself is durable rather than merely ordered.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'

export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null
  private pending: (() => T) | null = null

  constructor(
    private readonly path: string | null,
    private readonly onError: (error: Error) => void,
    private readonly debounceMs = 250
  ) {}

  /**
   * Reads the snapshot.
   *
   * A *missing* file is normal — first run. A *corrupt* one is not, and must
   * not be quietly treated as empty: the next scheduled flush would overwrite
   * it with that empty state, silently unpairing every phone. So it is moved
   * aside and the failure is raised, which makes the restart clean, leaves the
   * bytes for inspection, and puts one loud line where an operator will see it.
   */
  read(): T | null {
    if (!this.path) {
      return null
    }
    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
    try {
      return JSON.parse(raw) as T
    } catch {
      const quarantine = `${this.path}.corrupt`
      try {
        renameSync(this.path, quarantine)
      } catch {
        // If it cannot even be moved, refusing to start is still the right
        // outcome — the message below says where to look.
      }
      throw new Error(
        `${this.path} is not valid JSON; moved to ${quarantine}. ` +
          'Restart to begin from empty state, or restore a backup first.'
      )
    }
  }

  /** Coalesces bursts of mutations into one write. */
  schedule(snapshot: () => T): void {
    if (!this.path) {
      return
    }
    this.pending = snapshot
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.debounceMs)
    this.timer.unref?.()
  }

  flush(): void {
    if (!this.path || !this.pending) {
      return
    }
    const snapshot = this.pending
    const tmp = `${this.path}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      // fsync the temp file *before* the rename. Without it the rename can be
      // ordered ahead of the data, and a power cut leaves a valid directory
      // entry pointing at a truncated or zero-length file — which is worse than
      // no file at all, because it looks like real state.
      const handle = openSync(tmp, 'w', 0o600)
      try {
        writeFileSync(handle, JSON.stringify(snapshot()))
        fsyncSync(handle)
      } finally {
        closeSync(handle)
      }
      renameSync(tmp, this.path)
    } catch (error) {
      // The dirty marker stays set: a full disk or a permission problem must
      // leave the state pending so the next flush retries, rather than
      // silently dropping the write.
      this.onError(error as Error)
      try {
        unlinkSync(tmp)
      } catch {
        // Best effort; a stale temp file is harmless and is overwritten next time.
      }
      return
    }
    // Only now is the write committed, so only now is the state clean.
    this.pending = null
    // Separate from the write: without this the rename can still be lost to a
    // power cut, because the file contents are durable but the directory entry
    // pointing at them is not. It is also the part most likely to be
    // unsupported on an exotic filesystem, and a failure here does not mean the
    // data was lost — so it must not be reported as a failed write.
    try {
      const dir = openSync(dirname(this.path), 'r')
      try {
        fsyncSync(dir)
      } finally {
        closeSync(dir)
      }
    } catch {
      // Durability is best effort; correctness of the visible file is not.
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flush()
  }
}
