import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, extname, join } from 'node:path'

/**
 * How many of a candidate's leading lines to examine.
 *
 * A compaction replays the prior conversation into the new file, and the
 * immediate ancestor is named by the `isCompactSummary` row near the top — line
 * 47 in the session that prompted this. Grandparents appear thousands of lines
 * in, which is fine: this only ever needs the DIRECT child, and the watch
 * re-arms after each hop, so a chain of rolls is walked one link at a time.
 *
 * Counted in lines, not bytes: those 47 lines are 540KB because
 * `file-history-snapshot` rows run 12KB each, so any byte budget tight enough to
 * be cheap on a stranger cuts the answer off on a real descendant. The scan
 * streams and stops the moment it knows, so the common case reads far less.
 */
const HEAD_LINES = 400

/**
 * Where a rolled session continued, and under which id.
 *
 * The id matters as much as the path: only the DIRECT ancestor is replayed near
 * enough to the top to be found in a bounded head read, so following a chain of
 * rolls means re-searching under each new id in turn.
 */
export type TranscriptSuccessor = { path: string; sessionId: string }

type Args = {
  /** The transcript the watcher is bound to. */
  boundPath: string
  /** The session id that file belongs to. */
  sessionId: string
  signal?: AbortSignal
  readDirectory?: (dirPath: string) => Promise<string[]>
  readLines?: (path: string) => AsyncIterable<string>
  mtimeMs?: (path: string) => Promise<number>
}

async function defaultReadDirectory(dirPath: string): Promise<string[]> {
  return (await readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name) === '.jsonl')
    .map((entry) => entry.name)
}

function defaultReadLines(path: string): AsyncIterable<string> {
  // Closing the reader early (a `break` in the consumer) destroys the stream, so
  // a decided candidate stops costing I/O immediately.
  return createInterface({ input: createReadStream(path), crlfDelay: Infinity })
}

async function defaultMtimeMs(path: string): Promise<number> {
  return (await stat(path)).mtimeMs
}

/**
 * Does this file's head claim `sessionId` as an ancestor?
 *
 * The discriminator is the two spellings Claude writes side by side: `sessionId`
 * (camelCase) is the file's OWN session and is uniform throughout, while
 * `session_id` (snake_case) rides along inside replayed rows and still names the
 * session they were originally written under. So a row carrying
 * `session_id === ours` in a file whose own `sessionId` differs is a positive
 * statement of descent — not a heuristic about timing or names.
 */
async function ownSessionIfDescendedFrom(
  lines: AsyncIterable<string>,
  sessionId: string,
  signal?: AbortSignal
): Promise<string | null> {
  let owner: string | null = null
  let claimsDescent = false
  let seen = 0
  for await (const line of lines) {
    signal?.throwIfAborted()
    if (++seen > HEAD_LINES) {
      return null
    }
    if (!line.startsWith('{')) {
      continue
    }
    // These carry neither id and are 12KB apiece — most of what a scan walks.
    if (line.includes('"type":"file-history-snapshot"')) {
      continue
    }
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (owner === null && typeof row.sessionId === 'string' && row.sessionId !== sessionId) {
      owner = row.sessionId
    }
    if (row.session_id === sessionId) {
      claimsDescent = true
    }
    if (owner !== null && claimsDescent) {
      return owner
    }
  }
  return null
}

/**
 * Finds the file a rolled Claude session continued into, or null.
 *
 * Compaction does not append: it opens a NEW transcript under a NEW session id
 * and replays the conversation into it. Nothing in the old file says so — it
 * simply stops — and the session id the watcher holds still resolves to it,
 * because that file is exactly `<old-id>.jsonl` and still exists. That is why
 * the resolver's "stale paths fall through to the id-based search" never fired
 * here, and why a watcher can sit healthy on a dead file for hours reporting
 * `watching: true` with nothing to deliver.
 *
 * Only files newer than the bound one are considered, so an idle session (whose
 * successors do not exist) costs one readdir and nothing else.
 */
export async function findSuccessorTranscript(args: Args): Promise<TranscriptSuccessor | null> {
  const {
    boundPath,
    sessionId,
    signal,
    readDirectory = defaultReadDirectory,
    readLines = defaultReadLines,
    mtimeMs = defaultMtimeMs
  } = args
  signal?.throwIfAborted()

  const dir = dirname(boundPath)
  const boundMtime = await mtimeMs(boundPath)
  const names = await readDirectory(dir)

  const candidates: { path: string; mtime: number }[] = []
  for (const name of names) {
    signal?.throwIfAborted()
    const path = join(dir, name)
    if (path === boundPath) {
      continue
    }
    let mtime: number
    try {
      mtime = await mtimeMs(path)
    } catch {
      continue
    }
    if (mtime > boundMtime) {
      candidates.push({ path, mtime })
    }
  }

  // Newest first: the end of a roll chain is the file actually being written.
  candidates.sort((a, b) => b.mtime - a.mtime)
  for (const candidate of candidates) {
    signal?.throwIfAborted()
    let owner: string | null
    try {
      owner = await ownSessionIfDescendedFrom(readLines(candidate.path), sessionId, signal)
    } catch (error) {
      signal?.throwIfAborted()
      // A sibling that vanished or refused mid-scan is not a verdict.
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }
      continue
    }
    if (owner) {
      return { path: candidate.path, sessionId: owner }
    }
  }
  return null
}
