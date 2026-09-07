import type { PushDatabase } from './push-database.js'

export async function ensurePushSessionIndex(database: PushDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.lockQuotaScope('orca-push-session-schema')
    const indexQuery =
      database.dialect === 'postgres'
        ? "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'push_sessions' AND indexname = 'push_sessions_host'"
        : "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'push_sessions_host'"
    if ((await transaction.query(indexQuery)).length) return
    // Retain the newest session when upgrading a database with duplicate hosts.
    await transaction.query(`DELETE FROM push_sessions WHERE token_hash IN (
      SELECT token_hash FROM (
        SELECT token_hash, ROW_NUMBER() OVER (
          PARTITION BY host_fingerprint ORDER BY created_at DESC, token_hash DESC
        ) AS position FROM push_sessions
      ) AS ranked WHERE position > 1
    )`)
    await transaction.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS push_sessions_host ON push_sessions(host_fingerprint)'
    )
  })
}
