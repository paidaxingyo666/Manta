import { runProcess } from '../../shared/child-process/run-process'

/** Session-name namespace Manta gives one daemon per browser tab. */
export const MANTA_TAB_SESSION_PREFIX = 'manta-tab-'

const SWEEP_TIMEOUT_MS = 5_000
const SWEEP_MAX_OUTPUT_BYTES = 256 * 1024

type SessionListEnvelope = {
  data?: { sessions?: unknown }
}

function parseSessionNames(stdout: string): string[] {
  let envelope: SessionListEnvelope
  try {
    envelope = JSON.parse(stdout) as SessionListEnvelope
  } catch {
    return []
  }
  const sessions = envelope?.data?.sessions
  if (!Array.isArray(sessions)) {
    return []
  }
  return sessions.filter((name): name is string => typeof name === 'string' && name.length > 0)
}

/**
 * Close agent-browser daemons left behind by a previous Manta run.
 *
 * A crash (or SIGKILL) leaves one daemon per open tab with nobody holding its
 * name; `closeStaleAgentBrowserSession` only resets the single name a new tab
 * is about to reuse, so the rest persist. This closes them through
 * agent-browser's own CLI rather than by walking pids.
 *
 * Scoping — this only runs when Manta derived the socket directory itself
 * (`ownsSocketDirectory`), because that private per-profile directory is what
 * proves the enumeration can only see this Manta profile's daemons. An inherited
 * `AGENT_BROWSER_SOCKET_DIR` can be shared with a second Manta profile, and
 * Windows gets none at all (named pipes make the directory moot); both cases
 * skip the sweep rather than run a `session list` that could close a daemon Manta
 * does not own, and stay bounded by `AGENT_BROWSER_IDLE_TIMEOUT_MS` instead.
 *
 * `MANTA_DISABLE_AGENT_BROWSER_SWEEP=1` turns it off in the field. The other two
 * behaviours this PR adds are already recoverable without a build — the idle bound
 * is an env passthrough an operator can raise, and the quit close is bounded by its
 * own timeout — but a sweep that closes the wrong daemon, or spawns one process per
 * stale name on a profile with hundreds, would otherwise need a revert.
 */
export async function sweepOrphanedAgentBrowserSessions(options: {
  binaryPath: string
  env: NodeJS.ProcessEnv
  ownsSocketDirectory: boolean
  isSessionLive?: (sessionName: string) => boolean
}): Promise<string[]> {
  if (!options.ownsSocketDirectory || process.env.MANTA_DISABLE_AGENT_BROWSER_SWEEP === '1') {
    return []
  }
  let listed: string[]
  try {
    const result = await runProcess({
      program: options.binaryPath,
      args: ['session', 'list', '--json'],
      env: options.env,
      timeoutMs: SWEEP_TIMEOUT_MS,
      maxOutputBytes: SWEEP_MAX_OUTPUT_BYTES
    })
    listed = result.timedOut ? [] : parseSessionNames(result.stdout)
  } catch {
    return []
  }

  const closed: string[] = []
  for (const sessionName of listed) {
    if (!sessionName.startsWith(MANTA_TAB_SESSION_PREFIX) || options.isSessionLive?.(sessionName)) {
      continue
    }
    try {
      await runProcess({
        program: options.binaryPath,
        args: ['--session', sessionName, 'close'],
        env: options.env,
        timeoutMs: SWEEP_TIMEOUT_MS,
        maxOutputBytes: SWEEP_MAX_OUTPUT_BYTES
      })
      closed.push(sessionName)
    } catch {
      // A daemon that died mid-sweep needs no closing.
    }
  }
  return closed
}
