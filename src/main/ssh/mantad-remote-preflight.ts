import { randomUUID } from 'node:crypto'
import { ORCAD_NODE_RUNTIME_IDENTITY } from '../../shared/orcad-node-runtime-identity'
import { ORCAD_NODE_RUNTIME_MARKER_FILENAME } from '../../shared/mantad-artifacts'
import {
  ORCAD_PROFILE_PREFLIGHT_FLAG,
  ORCAD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseOrcadProfilePreflight
} from '../../shared/mantad-profile-preflight'
import { assertPosixOrcadHost } from './mantad-remote-host-support'
import {
  orcadWindowsBaseDir,
  orcadWindowsHostOpCommand,
  orcadWindowsNodeCommandLine,
  readOrcadWindowsEncodedAnswer
} from './mantad-remote-windows-node'
import { ORCAD_WINDOWS_RUNTIME_MARKER } from './mantad-windows-host-script'
import { orcadNodeSlotRuntimeCommand } from './mantad-remote-runtime'
import { execCommand } from './ssh-relay-deploy-helpers'
import { shellEscape } from './ssh-connection-utils'
import { isWindowsRemoteHost, joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import type { SshConnection } from './ssh-connection'

export function orcadProfilePreflightCommand(
  host: RemoteHostPlatform,
  directory: string,
  nonce: string
): string {
  assertPosixOrcadHost(host)
  // Why no host-Node fallback: a candidate this client installed is always a Node slot.
  const marker = shellEscape(joinRemotePath(host, directory, ORCAD_NODE_RUNTIME_MARKER_FILENAME))
  const launch = [
    'MANTA_BACKGROUND_LAUNCH=1',
    '"$orcad_runtime"',
    shellEscape(joinRemotePath(host, directory, 'mantad.js')),
    ORCAD_PROFILE_PREFLIGHT_FLAG,
    shellEscape(nonce)
  ].join(' ')
  return `[ -e ${marker} ] || exit 78; ${orcadNodeSlotRuntimeCommand(host, directory)}${launch}`
}

/** Failure leaves the incumbent and its data untouched, including an unconfirmed SSH exit. */
export async function preflightInstalledOrcad(options: {
  conn: SshConnection
  host: RemoteHostPlatform
  remoteInstallDir: string
  fullVersion: string
  signal?: AbortSignal
}): Promise<void> {
  const nonce = randomUUID()
  const command = isWindowsRemoteHost(options.host)
    ? await windowsOrcadProfilePreflightCommand(options, nonce)
    : orcadProfilePreflightCommand(options.host, options.remoteInstallDir, nonce)
  const output = await execCommand(options.conn, command, {
    signal: options.signal,
    timeoutMs: ORCAD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    wrapCommand: !isWindowsRemoteHost(options.host)
  })
  parseOrcadProfilePreflight(output, nonce, ORCAD_NODE_RUNTIME_IDENTITY, options.fullVersion)
}

/**
 * Windows: resolve the slot's node.exe, then run its `mantad.js` with plain argv. No
 * MANTA_BACKGROUND_LAUNCH here: mantad opens no window, and argv cannot set environment.
 */
async function windowsOrcadProfilePreflightCommand(
  options: {
    conn: SshConnection
    host: RemoteHostPlatform
    remoteInstallDir: string
    signal?: AbortSignal
  },
  nonce: string
): Promise<string> {
  const { host, remoteInstallDir } = options
  const runtime = readOrcadWindowsEncodedAnswer(
    await execCommand(
      options.conn,
      orcadWindowsHostOpCommand(host, orcadWindowsBaseDir(host, remoteInstallDir), 'slot-runtime', [
        remoteInstallDir
      ]),
      { signal: options.signal, wrapCommand: false }
    ),
    ORCAD_WINDOWS_RUNTIME_MARKER
  )
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this mantad slot needs.')
  }
  return orcadWindowsNodeCommandLine(runtime, [
    joinRemotePath(host, remoteInstallDir, 'mantad.js'),
    ORCAD_PROFILE_PREFLIGHT_FLAG,
    nonce
  ])
}
