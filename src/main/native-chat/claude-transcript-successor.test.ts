/**
 * A compacted Claude session continues in a NEW file under a NEW id, and
 * nothing in the old file says so — it simply stops. The session id the watcher
 * holds still resolves to it, because that file is exactly `<old-id>.jsonl` and
 * still exists, so the resolver's own "stale paths fall through" never fires.
 *
 * Shapes here are taken from a real roll: `sessionId` (camelCase) is the file's
 * own session; `session_id` (snake_case) rides inside replayed rows and still
 * names the session they were written under.
 */
import { describe, expect, it } from 'vitest'
import { findSuccessorTranscript } from './claude-transcript-successor'

const OLD = 'd7088df0-6130-486e-955a-eb08b295acce'
const NEW = '051ba680-d60e-42e8-b69d-cd73abd31eac'
const BOUND = `/p/${OLD}.jsonl`

function rows(own: string, replayed: string[]): string {
  return [
    JSON.stringify({ type: 'ai-title', sessionId: own }),
    ...replayed.map((id) => JSON.stringify({ type: 'user', sessionId: own, session_id: id })),
    JSON.stringify({ type: 'assistant', sessionId: own })
  ].join('\n')
}

type World = { names: string[]; mtimes: Record<string, number>; heads: Record<string, string> }

function find(world: World, sessionId = OLD) {
  return findSuccessorTranscript({
    boundPath: BOUND,
    sessionId,
    readDirectory: async () => world.names,
    mtimeMs: async (path) => {
      const at = world.mtimes[path]
      if (at === undefined) {
        throw new Error(`ENOENT ${path}`)
      }
      return at
    },
    readLines: async function* (path) {
      yield* (world.heads[path] ?? '').split('\n')
    }
  })
}

describe('findSuccessorTranscript', () => {
  it('follows a roll to the file that replays our rows', async () => {
    await expect(
      find({
        names: [`${OLD}.jsonl`, `${NEW}.jsonl`],
        mtimes: { [BOUND]: 100, [`/p/${NEW}.jsonl`]: 200 },
        heads: { [`/p/${NEW}.jsonl`]: rows(NEW, [OLD]) }
      })
    ).resolves.toEqual({ path: `/p/${NEW}.jsonl`, sessionId: NEW })
  })

  /**
   * The whole point of the descent check. An idle session is quiet for hours and
   * its neighbours are other conversations that happen to be newer — rebinding
   * to one would move the user's chat to a stranger's transcript.
   */
  it('ignores a newer file that is a different conversation', async () => {
    await expect(
      find({
        names: [`${OLD}.jsonl`, 'stranger.jsonl'],
        mtimes: { [BOUND]: 100, '/p/stranger.jsonl': 900 },
        heads: { '/p/stranger.jsonl': rows('stranger', ['someone-else']) }
      })
    ).resolves.toBeNull()
  })

  // A file older than the bound one cannot be where the session went next.
  it('never rebinds backwards to an ancestor', async () => {
    await expect(
      find({
        names: [`${OLD}.jsonl`, 'ancestor.jsonl'],
        mtimes: { [BOUND]: 100, '/p/ancestor.jsonl': 50 },
        heads: { '/p/ancestor.jsonl': rows('ancestor', [OLD]) }
      })
    ).resolves.toBeNull()
  })

  /**
   * Only the DIRECT ancestor is replayed near the top; a grandparent lands
   * thousands of lines in. Returning the owner id is what lets the caller
   * re-search under it, so a chain is walked one link at a time.
   */
  it('reports the id the session continued under', async () => {
    const result = await find({
      names: [`${OLD}.jsonl`, `${NEW}.jsonl`],
      mtimes: { [BOUND]: 100, [`/p/${NEW}.jsonl`]: 200 },
      heads: { [`/p/${NEW}.jsonl`]: rows(NEW, [OLD]) }
    })
    expect(result?.sessionId).toBe(NEW)
  })

  /**
   * A subagent writes its own file under the SAME session id. It is not where
   * the conversation continued, and reporting it would rebind chat to a
   * subagent's transcript while keeping the dead id — so the next roll could
   * never be found either.
   */
  it('does not mistake a same-session sidecar for a successor', async () => {
    await expect(
      find({
        names: [`${OLD}.jsonl`, 'sidecar.jsonl'],
        mtimes: { [BOUND]: 100, '/p/sidecar.jsonl': 200 },
        heads: { '/p/sidecar.jsonl': rows(OLD, [OLD]) }
      })
    ).resolves.toBeNull()
  })

  it('prefers the newest descendant when several rolls exist', async () => {
    await expect(
      find({
        names: [`${OLD}.jsonl`, 'mid.jsonl', 'newest.jsonl'],
        mtimes: { [BOUND]: 100, '/p/mid.jsonl': 200, '/p/newest.jsonl': 300 },
        heads: {
          '/p/mid.jsonl': rows('mid', [OLD]),
          '/p/newest.jsonl': rows('newest', [OLD])
        }
      })
    ).resolves.toEqual({ path: '/p/newest.jsonl', sessionId: 'newest' })
  })

  // The head is cut mid-file, so the last line is routinely half a row.
  it('reads past a truncated final line', async () => {
    await expect(
      find({
        names: [`${OLD}.jsonl`, `${NEW}.jsonl`],
        mtimes: { [BOUND]: 100, [`/p/${NEW}.jsonl`]: 200 },
        heads: { [`/p/${NEW}.jsonl`]: `${rows(NEW, [OLD])}\n{"type":"assist` }
      })
    ).resolves.toEqual({ path: `/p/${NEW}.jsonl`, sessionId: NEW })
  })

  // A sibling that vanished between readdir and stat is not a failure.
  it('skips a candidate that disappeared mid-scan', async () => {
    await expect(
      find({
        names: [`${OLD}.jsonl`, 'gone.jsonl', `${NEW}.jsonl`],
        mtimes: { [BOUND]: 100, [`/p/${NEW}.jsonl`]: 200 },
        heads: { [`/p/${NEW}.jsonl`]: rows(NEW, [OLD]) }
      })
    ).resolves.toEqual({ path: `/p/${NEW}.jsonl`, sessionId: NEW })
  })
})
