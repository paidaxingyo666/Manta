import {
  appendFileSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  type Stats
} from 'node:fs'
import { join } from 'node:path'
import { isDefinitiveAbsence } from '../../shared/definitive-filesystem-absence'
import {
  ClaudeProfileSurfaceError,
  warnClaudeProfile,
  type ClaudeProfileReport,
  type ClaudeProfileSurfaceOutcome
} from './claude-profile-report'

export const CLAUDE_PROFILE_MERGE_SUFFIX = '.manta-profile-merge'
const HISTORY = 'history.jsonl'
const PENDING = `${HISTORY}${CLAUDE_PROFILE_MERGE_SUFFIX}`

export function lstatIfPresent(file: string): Stats | undefined {
  try {
    return lstatSync(file)
  } catch (error) {
    if (!isDefinitiveAbsence(error)) {
      throw error
    }
    return undefined
  }
}

function appendHistory(destination: string, lines: string[]): void {
  if (lines.length === 0) {
    return
  }
  const size = statSync(destination).size
  let separator = false
  if (size > 0) {
    const fd = openSync(destination, 'r')
    try {
      const tail = Buffer.alloc(1)
      readSync(fd, tail, 0, 1, size - 1)
      separator = tail[0] !== 10
    } finally {
      closeSync(fd)
    }
  }
  // Why: every record ends its line so it cannot fuse with Claude's next append.
  appendFileSync(destination, `${separator ? '\n' : ''}${lines.join('\n')}\n`)
}

/**
 * Keeps the renamed file and its cursor: a Claude that opened the old path just before the swap
 * appends there, and the next run drains it; a later run that finds nothing new deletes it.
 */
function drainHistory(pending: string, destination: string, shared: Set<string>): void {
  const content = readFileSync(pending)
  const cursor = `${pending}.offset`
  let offset = 0
  let saved = false
  try {
    const stored = Number(readFileSync(cursor, 'utf8'))
    if (Number.isSafeInteger(stored) && stored >= 0 && stored <= content.length) {
      offset = stored
      saved = true
    }
  } catch (error) {
    if (!isDefinitiveAbsence(error)) {
      throw error
    }
  }
  if (saved && offset === content.length) {
    // Why: cursor first; a copy without one re-drains to nothing because its lines are present.
    unlinkSync(cursor)
    unlinkSync(pending)
    return
  }
  // Why: `claude purge` rewrites the shared file through the link; only lines it lacks are new.
  const lines = content
    .subarray(offset)
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '' && !shared.has(line))
  appendHistory(destination, lines)
  for (const line of lines) {
    shared.add(line)
  }
  // Advance only after append; a crash re-drains, and lines already present are skipped.
  writeFileSync(cursor, `${content.length}\n`, { mode: 0o600 })
}

function pendingGeneration(name: string): number | null {
  if (name === PENDING) {
    return 0
  }
  const suffix = name.slice(PENDING.length + 1)
  return name.startsWith(`${PENDING}-`) && /^\d+$/.test(suffix) ? Number(suffix) : null
}

function nextFreePath(base: string): string {
  for (let generation = 0; ; generation++) {
    const candidate = generation === 0 ? base : `${base}-${generation}`
    if (!lstatIfPresent(candidate)) {
      return candidate
    }
  }
}

/** POSIX only: links the profile's `history.jsonl` to the shared one and appends its own lines. */
export function mergeClaudeProfilePromptHistory(
  profile: string,
  home: string,
  report: ClaudeProfileReport
): ClaudeProfileSurfaceOutcome {
  const source = join(profile, HISTORY)
  const destination = join(home, HISTORY)
  if (!lstatIfPresent(destination)) {
    writeFileSync(destination, '', { flag: 'wx', mode: 0o600 })
  }
  const shared = new Set(readFileSync(destination, 'utf8').split('\n'))
  const pendings: { name: string; generation: number }[] = []
  for (const item of readdirSync(profile, { withFileTypes: true })) {
    const generation = pendingGeneration(item.name)
    if (item.isFile() && generation !== null) {
      pendings.push({ name: item.name, generation })
    }
  }
  // Why: directory order is not creation order; generations keep prompts in the order they were written.
  pendings.sort((left, right) => left.generation - right.generation)
  for (const { name } of pendings) {
    try {
      drainHistory(join(profile, name), destination, shared)
    } catch (error) {
      // Why: an old retained copy is bookkeeping; it must not keep the profile from being linked.
      warnClaudeProfile(report, HISTORY, error)
    }
  }
  const current = lstatIfPresent(source)
  if (current?.isSymbolicLink()) {
    return realpathSync(source) === realpathSync(destination) ? 'unchanged' : 'user-owned'
  }
  if (current && !current.isFile()) {
    return 'user-owned'
  }
  let aside: string | undefined
  if (current) {
    aside = nextFreePath(join(profile, PENDING))
    renameSync(source, aside)
  }
  try {
    symlinkSync(destination, source)
  } catch (error) {
    if (aside && !lstatIfPresent(source)) {
      renameSync(aside, source)
    }
    throw new ClaudeProfileSurfaceError('link-failed', String(error))
  }
  if (aside) {
    drainHistory(aside, destination, shared)
  }
  return 'linked'
}
