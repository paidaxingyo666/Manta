// Why: jcode config paths and the [hooks] table contract. jcode loads lifecycle
// hooks from ~/.jcode/config.toml (or $JCODE_HOME/config.toml); Manta writes its
// managed observer hooks there so sessions launched outside Manta still report.
import { homedir } from 'node:os'
import { join } from 'node:path'

const JCODE_SCRIPT_BASE = 'jcode-hook'

// The lifecycle points Manta subscribes to, in the order jcode fires them.
// `pre_tool` is jcode's synchronous gate, but the managed script backgrounds its
// POST and exits 0 immediately, so Manta observes the tool without ever holding
// up a tool call. Without it a long `bash` would show no tool at all until it
// finished, and `request_permission` (the only jcode tool a human answers)
// would only be seen after the answer.
export const JCODE_HOOK_EVENTS = [
  'session_start',
  'turn_start',
  'pre_tool',
  'post_tool',
  'turn_end',
  'session_end'
] as const
export type JcodeHookEvent = (typeof JCODE_HOOK_EVENTS)[number]

/** jcode waits for this one; the managed script must never block on it. */
export function isJcodeGateHookEvent(event: JcodeHookEvent): boolean {
  return event === 'pre_tool'
}

export function getJcodeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.JCODE_HOME?.trim()
  return explicit ? join(explicit, 'config.toml') : join(homedir(), '.jcode', 'config.toml')
}

export function getJcodeRemoteConfigPath(remoteHome: string): string {
  return `${remoteHome.replace(/\/+$/, '')}/.jcode/config.toml`
}

export function getJcodeManagedScriptFileName(): string {
  return process.platform === 'win32' ? `${JCODE_SCRIPT_BASE}.cmd` : `${JCODE_SCRIPT_BASE}.sh`
}

export function getJcodePosixManagedScriptFileName(): string {
  return `${JCODE_SCRIPT_BASE}.sh`
}

export function getJcodeManagedScriptPath(): string {
  return getSharedJcodeScriptPath(getJcodeManagedScriptFileName())
}

export function getSharedJcodeScriptPath(scriptFileName: string): string {
  return join(homedir(), '.manta', 'agent-hooks', scriptFileName)
}

// Why: jcode executes hook commands directly (not through a shell), so the
// managed value must be the bare script path — no `if [ -f … ]` wrapper. Paths
// with spaces are handled by jcode's shell-style command parsing.
export function getJcodeManagedCommand(scriptPath: string): string {
  return scriptPath
}

export function getJcodeRemoteManagedCommand(scriptPath: string): string {
  return scriptPath
}

export function isJcodeManagedCommand(command: string | null | undefined): boolean {
  return typeof command === 'string' && command.includes('agent-hooks/jcode-hook')
}
