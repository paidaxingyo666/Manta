// Where in-box hook clients find this relay's loopback hook server: endpoint-directory naming
// policy (per-user $HOME default, sibling-of-socket layout, Windows named-pipe path flattening) and
// the MANTA_AGENT_HOOK_* env vars injected into relay-spawned PTYs. IO-free.
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'

import {
  MANTA_HOOK_PROTOCOL_VERSION,
  MANTA_HOOK_RAW_JSON_TRANSPORT
} from '../shared/agent-hook-types'

// Why: relay's userData equivalent under $HOME so each user on a shared dev box gets their own 0o700 dir.
const RELAY_HOOKS_DIR_NAME = '.manta-relay'
const RELAY_HOOKS_SUBDIR = 'agent-hooks'

export function defaultEndpointDir(): string {
  return join(homedir(), RELAY_HOOKS_DIR_NAME, RELAY_HOOKS_SUBDIR)
}

function isWindowsNamedPipePath(sockPath: string): boolean {
  return /^\\\\[.?]\\pipe\\/i.test(sockPath)
}

function windowsNamedPipeEndpointName(sockPath: string): string {
  return (
    sockPath
      .replace(/^\\\\[.?]\\pipe\\/i, '')
      .split(/[\\/]/)
      .findLast(Boolean) ?? 'relay'
  )
}

export function endpointDirForRelaySocket(sockPath: string): string {
  if (isWindowsNamedPipePath(sockPath)) {
    return join(defaultEndpointDir(), windowsNamedPipeEndpointName(sockPath))
  }
  return join(dirname(sockPath), RELAY_HOOKS_SUBDIR, basename(sockPath))
}

/** Env vars to inject into relay-spawned PTYs so the hook script/plugin POSTs back to the loopback server. */
export function buildRelayHookPtyEnv(coordinates: {
  port: number
  token: string
  env: string
  endpointFilePath: string
  endpointFileWritten: boolean
}): Record<string, string> {
  if (coordinates.port <= 0 || !coordinates.token) {
    return {}
  }
  const env: Record<string, string> = {
    MANTA_AGENT_HOOK_PORT: String(coordinates.port),
    MANTA_AGENT_HOOK_TOKEN: coordinates.token,
    MANTA_AGENT_HOOK_ENV: coordinates.env,
    MANTA_AGENT_HOOK_VERSION: MANTA_HOOK_PROTOCOL_VERSION,
    MANTA_AGENT_HOOK_TRANSPORT: MANTA_HOOK_RAW_JSON_TRANSPORT
  }
  if (coordinates.endpointFileWritten) {
    env.MANTA_AGENT_HOOK_ENDPOINT = coordinates.endpointFilePath
  }
  return env
}
