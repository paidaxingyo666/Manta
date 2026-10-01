import { randomUUID } from 'node:crypto'
import { ORCAD_BUN_RUNTIME_IDENTITY } from '../../shared/mantad-bun-runtime'
import { orcadBunRuntimeFilename } from '../../shared/mantad-artifacts'
import {
  ORCAD_PROFILE_PREFLIGHT_FLAG,
  ORCAD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseOrcadProfilePreflight
} from '../../shared/mantad-profile-preflight'
import { assertPosixOrcadHost } from './mantad-remote-host-support'
import { execCommand } from './ssh-relay-deploy-helpers'
import { shellEscape } from './ssh-connection-utils'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import type { SshConnection } from './ssh-connection'

export function orcadProfilePreflightCommand(
  host: RemoteHostPlatform,
  directory: string,
  nonce: string
): string {
  assertPosixOrcadHost(host)
  return [
    'MANTA_BACKGROUND_LAUNCH=1',
    shellEscape(joinRemotePath(host, directory, orcadBunRuntimeFilename(host.os))),
    shellEscape(joinRemotePath(host, directory, 'mantad.js')),
    ORCAD_PROFILE_PREFLIGHT_FLAG,
    shellEscape(nonce)
  ].join(' ')
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
  const output = await execCommand(
    options.conn,
    orcadProfilePreflightCommand(options.host, options.remoteInstallDir, nonce),
    { signal: options.signal, timeoutMs: ORCAD_PROFILE_PREFLIGHT_TIMEOUT_MS }
  )
  parseOrcadProfilePreflight(output, nonce, ORCAD_BUN_RUNTIME_IDENTITY, options.fullVersion)
}
