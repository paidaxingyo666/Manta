import type Database from '../sqlite/sync-database'
import { columnExists, tableExists } from './schema-helpers'

export type OpenCodeUsageRow = {
  id: string
  session_id: string
  time_created: number
  time_updated: number | null
  data: string
  directory: string | null
  title: string | null
  worktree: string | null
  session_model: string | null
}

type OpenCodeSessionUsageRow = {
  id: string
  session_id: string
  time_created: number
  time_updated: number | null
  directory: string | null
  title: string | null
  worktree: string | null
  session_model: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
}

// Why: OpenCode 2 copies every v1 `session` row into `session_v2` and then only
// writes there, so a migrated opencode.db holds both tables and the same session
// id in each. Reading `session` alone loses every OpenCode 2 session (#15841);
// reading both unfiltered would double-count the migrated ones. Newest first,
// which only breaks ties — the fuller row wins, see `buildSessionTableSelect`.
const SESSION_TABLES_BY_PRIORITY = ['session_v2', 'session'] as const

// Columns the usage scan reads off a session row, with the SQL literal to
// substitute when a schema generation lacks the column.
const SESSION_SOURCE_COLUMNS: Record<string, string> = {
  project_id: 'NULL',
  directory: 'NULL',
  title: 'NULL',
  model: 'NULL',
  time_created: '0',
  time_updated: 'NULL',
  cost: '0',
  tokens_input: '0',
  tokens_output: '0',
  tokens_reasoning: '0',
  tokens_cache_read: '0',
  tokens_cache_write: '0'
}

const SESSION_TOKEN_COLUMNS = [
  'tokens_input',
  'tokens_output',
  'tokens_reasoning',
  'tokens_cache_read',
  'tokens_cache_write'
] as const

const SESSION_TOKEN_TOTAL = SESSION_TOKEN_COLUMNS.map((name) => `s.${name}`).join(' + ')

/** The same total against one raw session table, which may be missing columns. */
function sessionTableTokenTotal(db: Database.Database, table: string, alias: string): string {
  return SESSION_TOKEN_COLUMNS.map((name) =>
    columnExists(db, table, name) ? `${alias}.${name}` : '0'
  ).join(' + ')
}

function listSessionTables(db: Database.Database): string[] {
  return SESSION_TABLES_BY_PRIORITY.filter(
    (table) => tableExists(db, table) && columnExists(db, table, 'id')
  )
}

function buildSessionTableSelect(
  db: Database.Database,
  tables: readonly string[],
  index: number
): string {
  const table = tables[index] ?? ''
  const columns = Object.entries(SESSION_SOURCE_COLUMNS).map(
    ([name, fallback]) => `${columnExists(db, table, name) ? `t.${name}` : fallback} AS ${name}`
  )
  // Why the fuller row rather than the newer one: `session_v2` is not reliably a
  // superset. Upstream's importer recomputes v2 totals from decoded messages, so
  // a session whose messages fail to decode lands below its frozen legacy row; a
  // v2 table without the token columns at all scores 0 and would otherwise erase
  // the legacy row's usage entirely. Ties go to the higher-priority table, so a
  // faithful copy still resolves to `session_v2`.
  const total = sessionTableTokenTotal(db, table, 't')
  const exclusions = tables
    .map((other, otherIndex) => {
      if (otherIndex === index) {
        return null
      }
      const beats = otherIndex < index ? '>=' : '>'
      return `NOT EXISTS (SELECT 1 FROM ${other} o WHERE o.id = t.id AND ${sessionTableTokenTotal(db, other, 'o')} ${beats} ${total})`
    })
    .filter((clause) => clause !== null)
    .join(' AND ')
  return `SELECT t.id, ${columns.join(', ')} FROM ${table} t${exclusions ? ` WHERE ${exclusions}` : ''}`
}

/** A single deduplicated session relation spanning every session table generation. */
function buildSessionSource(db: Database.Database, tables: readonly string[]): string {
  const selects = tables.map((_table, index) => buildSessionTableSelect(db, tables, index))
  return `(${selects.join(' UNION ALL ')})`
}

function getProjectJoin(db: Database.Database): string {
  return tableExists(db, 'project')
    ? 'LEFT JOIN project p ON p.id = s.project_id'
    : 'LEFT JOIN (SELECT NULL AS id, NULL AS worktree) p ON 1 = 0'
}

function getAssistantSessionMessageCount(db: Database.Database): number {
  if (!tableExists(db, 'session_message')) {
    return 0
  }
  const assistantPredicate = columnExists(db, 'session_message', 'type')
    ? "type = 'assistant' AND json_extract(data, '$.tokens.input') IS NOT NULL"
    : "json_extract(data, '$.tokens.input') IS NOT NULL"
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SQLite aggregate rows are validated by the typed count field below.
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM session_message WHERE ${assistantPredicate}`)
    .get() as { count?: number } | undefined
  return row?.count ?? 0
}

// `some`, not `every`: a table missing the token columns scores 0 in the source's
// tie-break, so it can never outrank — or erase — a sibling that carries them.
function hasSessionUsageColumns(db: Database.Database, tables: readonly string[]): boolean {
  return tables.some((table) =>
    ['cost', 'tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read'].every(
      (columnName) => columnExists(db, table, columnName)
    )
  )
}

function getSessionUsageRowCount(db: Database.Database, sessionSource: string): number {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SQLite aggregate rows are validated by the typed count field below.
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM ${sessionSource} s
       WHERE ${SESSION_TOKEN_TOTAL} > 0`
    )
    .get() as { count?: number } | undefined
  return row?.count ?? 0
}

function selectSessionUsageRows(db: Database.Database, sessionSource: string): OpenCodeUsageRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT aliases match OpenCodeSessionUsageRow across supported schemas.
  const rows = db
    .prepare(
      `SELECT s.id, s.id AS session_id, s.time_created, s.time_updated,
              s.directory, s.title, p.worktree, s.model AS session_model,
              s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read,
              s.tokens_cache_write
       FROM ${sessionSource} s
       ${getProjectJoin(db)}
       WHERE ${SESSION_TOKEN_TOTAL} > 0
       ORDER BY s.time_created, s.id`
    )
    .all() as OpenCodeSessionUsageRow[]

  return rows.map((row) => ({
    id: row.id,
    session_id: row.session_id,
    time_created: row.time_created,
    time_updated: row.time_updated,
    directory: row.directory,
    title: row.title,
    worktree: row.worktree,
    session_model: row.session_model,
    data: JSON.stringify({
      cost: row.cost,
      tokens: {
        input: row.tokens_input,
        output: row.tokens_output,
        reasoning: row.tokens_reasoning,
        total:
          row.tokens_input +
          row.tokens_output +
          row.tokens_reasoning +
          row.tokens_cache_read +
          row.tokens_cache_write,
        cache: {
          read: row.tokens_cache_read,
          write: row.tokens_cache_write
        }
      }
    })
  }))
}

export function selectUsageRows(db: Database.Database): OpenCodeUsageRow[] {
  const sessionTables = listSessionTables(db)
  if (sessionTables.length === 0) {
    return []
  }
  const sessionSource = buildSessionSource(db, sessionTables)

  // Why: newer OpenCode DBs maintain session-level token/cost totals. Reading
  // one aggregate row per session is faster than parsing every message blob.
  if (hasSessionUsageColumns(db, sessionTables) && getSessionUsageRowCount(db, sessionSource) > 0) {
    return selectSessionUsageRows(db, sessionSource)
  }

  const projectJoin = getProjectJoin(db)

  if (getAssistantSessionMessageCount(db) > 0) {
    const assistantPredicate = columnExists(db, 'session_message', 'type')
      ? "sm.type = 'assistant'"
      : "json_extract(sm.data, '$.tokens.input') IS NOT NULL"
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT aliases match OpenCodeUsageRow across supported schemas.
    return db
      .prepare(
        `SELECT sm.id, sm.session_id, sm.time_created, sm.time_updated, sm.data,
                s.directory, s.title, p.worktree, s.model AS session_model
         FROM session_message sm
         JOIN ${sessionSource} s ON s.id = sm.session_id
         ${projectJoin}
         WHERE ${assistantPredicate}
         ORDER BY sm.time_created, sm.id`
      )
      .all() as OpenCodeUsageRow[]
  }

  if (!tableExists(db, 'message')) {
    return []
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT aliases match OpenCodeUsageRow across supported schemas.
  return db
    .prepare(
      `SELECT m.id, m.session_id, m.time_created, m.time_updated, m.data,
              s.directory, s.title, p.worktree, s.model AS session_model
       FROM message m
       JOIN ${sessionSource} s ON s.id = m.session_id
       ${projectJoin}
       WHERE json_extract(m.data, '$.role') = 'assistant'
       ORDER BY m.time_created, m.id`
    )
    .all() as OpenCodeUsageRow[]
}
