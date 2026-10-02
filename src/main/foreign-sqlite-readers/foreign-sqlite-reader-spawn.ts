import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { currentWorkerEntryLayout } from '../worker-thread-entry-path'
import type { CursorDesktopProfileReadResult } from './cursor-profile-result'
import { ForeignSqliteReaderClient } from './foreign-sqlite-reader-client'
import { resolveForeignSqliteReaderEntryPath } from './foreign-sqlite-reader-entry-path'

// Why: owns the process-wide client and the real worker factory, so the client
// class stays testable with a fake factory and callers see only plain functions.

function defaultWorkerFactory(): Worker {
  const workerPath = resolveForeignSqliteReaderEntryPath(currentWorkerEntryLayout(__dirname))
  // A missing entry (e.g. a host whose build omits it) throws here so reads fail closed.
  if (!existsSync(workerPath)) {
    throw new Error(`Foreign SQLite reader entry not found: ${workerPath}`)
  }
  return new Worker(workerPath)
}

let sharedClient: ForeignSqliteReaderClient | null = null

function getSharedClient(): ForeignSqliteReaderClient {
  sharedClient ??= new ForeignSqliteReaderClient({ workerFactory: defaultWorkerFactory })
  return sharedClient
}

/**
 * Read the Cursor IDE's stored session on the foreign SQLite reader worker.
 * @param dbPath - Cursor's state.vscdb.
 * @returns `missing`, `ok`, or `error` (also when the worker cannot answer).
 */
export function readCursorDesktopProfile(dbPath: string): Promise<CursorDesktopProfileReadResult> {
  return getSharedClient().readCursorProfile(dbPath)
}
