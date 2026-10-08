/** The installed slot's `mantad.js` identity, the same 16-hex prefix mantad reports in its health. */
import { shellEscape } from './ssh-connection-utils'
import { execOrcadRemote, type OrcadRemoteExecTarget } from './mantad-remote-runtime-control'
import { orcadWindowsBaseDir, orcadWindowsHostOpCommand } from './mantad-remote-windows-node'
import { ORCAD_BUILD_HASH_MARKER as BUILD_HASH_MARKER } from './mantad-windows-host-script'
import { isWindowsRemoteHost, joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'

export async function readRemoteOrcadBuildHash(
  target: OrcadRemoteExecTarget,
  remoteInstallDir: string
): Promise<string> {
  const output = await execOrcadRemote(
    target,
    remoteOrcadBuildHashCommand(target.host, remoteInstallDir)
  )
  const match = output.match(/__ORCAD_BUILD_HASH__\s+([a-fA-F0-9]{16})/u)
  if (!match?.[1]) {
    throw new Error('Could not verify the installed mantad build hash.')
  }
  return match[1].toLowerCase()
}

export function remoteOrcadBuildHashCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  if (isWindowsRemoteHost(host)) {
    return orcadWindowsHostOpCommand(
      host,
      orcadWindowsBaseDir(host, remoteInstallDir),
      'build-hash',
      [joinRemotePath(host, remoteInstallDir, 'mantad.js')]
    )
  }
  const path = shellEscape(joinRemotePath(host, remoteInstallDir, 'mantad.js'))
  // Why both tools: GNU/busybox ship sha256sum, macOS ships shasum; either prints the digest first.
  return [
    `orca_hash=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum ${path} | awk '{print $1}';`,
    `elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${path} | awk '{print $1}'; fi);`,
    `case "$orca_hash" in [0-9a-fA-F][0-9a-fA-F]*) printf '%s %.16s\\n' ${shellEscape(BUILD_HASH_MARKER)} "$orca_hash";; esac`
  ].join(' ')
}
