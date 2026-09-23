// Why: jcode's TUI client starts its own server and then waits a hardcoded 5s for
// the socket to answer a ping (`wait_for_server_ready` in
// crates/jcode-app-core/src/server/socket.rs). Manta gives every pane its own
// JCODE_RUNTIME_DIR, so every jcode pane is a COLD daemon start — and a cold start
// on a loaded machine overruns that budget, which is how an orchestration worker
// died with "Timed out waiting for responsive server socket" before its prompt was
// ever delivered. Starting the daemon as the PTY spawns gives it the shell's own
// startup time as head start, so the client finds a live socket instead of racing.
import { spawnProcess } from '../../shared/child-process/run-process'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'

/** Runtime dirs already pre-warmed in this Manta process; the daemon outlives one pane. */
const prewarmedRuntimeDirs = new Set<string>()

export function resetJcodeDaemonPrewarmForTests(): void {
  prewarmedRuntimeDirs.clear()
}

/** The runtime dir to warm, or null when this pane is not a local jcode launch. */
export function resolveJcodePrewarmRuntimeDir(args: {
  launchAgent?: string
  runtimeDir?: string
  platform?: NodeJS.Platform
}): string | null {
  // Why non-Windows only: the runtime dir is a unix-socket directory, and Manta
  // only stamps it off Windows (see shouldInjectJcodeRuntimeDir).
  if (args.launchAgent !== 'jcode' || (args.platform ?? process.platform) === 'win32') {
    return null
  }
  return args.runtimeDir !== undefined && args.runtimeDir.length > 0 ? args.runtimeDir : null
}

export function shouldPrewarmJcodeDaemon(args: {
  launchAgent?: string
  runtimeDir?: string
  platform?: NodeJS.Platform
}): boolean {
  return resolveJcodePrewarmRuntimeDir(args) !== null
}

/**
 * Start this pane's jcode daemon in the background, at most once per runtime dir.
 *
 * Fire-and-forget by contract: jcode's client starts its own server when none is
 * listening, so a pre-warm that fails costs nothing beyond the cold start Manta
 * already had. Never throws, and never blocks the spawn path.
 */
export function prewarmJcodeDaemon(args: {
  launchAgent?: string
  runtimeDir?: string
  cwd?: string
  env?: Record<string, string>
  platform?: NodeJS.Platform
}): boolean {
  const runtimeDir = resolveJcodePrewarmRuntimeDir(args)
  if (runtimeDir === null || prewarmedRuntimeDirs.has(runtimeDir)) {
    return false
  }
  prewarmedRuntimeDirs.add(runtimeDir)
  try {
    const child = spawnProcess({
      program: getTuiAgentLaunchCommand(TUI_AGENT_CONFIG.jcode, args.platform ?? process.platform),
      // Why --no-update: an update check on the pre-warm path would delay the very
      // socket the client is about to wait on.
      args: ['--no-update', 'serve'],
      cwd: args.cwd,
      env: { ...args.env, JCODE_RUNTIME_DIR: runtimeDir },
      detached: true,
      stdio: 'ignore'
    })
    // Why unref: the daemon is jcode's to own and must outlive this spawn; keeping a
    // handle would tie Manta's event loop to it.
    child.unref()
    child.on('error', () => {
      // A missing binary or a spawn refusal just means no head start.
      prewarmedRuntimeDirs.delete(runtimeDir)
    })
    return true
  } catch {
    prewarmedRuntimeDirs.delete(runtimeDir)
    return false
  }
}
