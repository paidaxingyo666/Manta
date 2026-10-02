import type {
  ForeignSqliteReaderRequest,
  ForeignSqliteReaderResponse
} from './foreign-sqlite-reader-protocol'
import { readCursorProfile } from './readers/cursor-profile'

/**
 * Run one foreign-app SQLite read on the worker thread.
 * @param request - A structured clone from the main process; its kind is untrusted.
 * @returns The reader's value, or an error naming a kind no reader owns.
 */
export function handleForeignSqliteReaderRequest(
  request: ForeignSqliteReaderRequest
): ForeignSqliteReaderResponse {
  try {
    if (request.kind === 'cursorProfile') {
      return { id: request.id, ok: true, value: readCursorProfile(request.dbPath) }
    }
    // A structured clone can carry any kind; one without a reader is refused, not guessed at.
    return unknownKind(request.id, request.kind)
  } catch (err) {
    return { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Why `never`: adding a request kind without a case here fails to compile.
function unknownKind(id: number, kind: never): ForeignSqliteReaderResponse {
  return { id, ok: false, error: `Unknown foreign SQLite reader kind: ${String(kind)}` }
}
