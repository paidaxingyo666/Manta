// Type-only and electron-free: the worker entry and the main-process client both import it.

type CursorProfileRequest = {
  id: number
  kind: 'cursorProfile'
  dbPath: string
}

export type ForeignSqliteReaderRequest = CursorProfileRequest

export type ForeignSqliteReaderKind = ForeignSqliteReaderRequest['kind']

export type ForeignSqliteReaderResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
