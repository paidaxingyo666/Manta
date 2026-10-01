import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SERVER_TARGETS, type ServerTarget } from '../../shared/node-runtime-pin'
import { ORCAD_SERVER_TARGET_FILENAME } from '../../shared/mantad-artifacts'
import type { SshConnection } from './ssh-connection'
import { execCommand } from './ssh-relay-deploy-helpers'
import type { RemoteHostPlatform } from './ssh-remote-platform'

export function parseOrcadLinuxLibc(output: string): 'glibc' | 'musl' {
  if (/\bmusl\b/i.test(output)) {
    return 'musl'
  }
  if (/\b(?:glibc|GNU libc|GNU C Library)\b/i.test(output)) {
    return 'glibc'
  }
  throw new Error('Could not identify the host C library for the bundled Manta runtime')
}

export async function resolveOrcadDeploymentTarget(options: {
  conn: SshConnection
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<ServerTarget> {
  const { host } = options
  if (host.os !== 'linux') {
    return `${host.os}-${host.arch}`
  }
  const exec =
    options.exec ??
    ((command: string) => execCommand(options.conn, command, { signal: options.signal }))
  let output = await exec('ldd --version 2>&1 || true')
  try {
    return `linux-${host.arch}-${parseOrcadLinuxLibc(output)}`
  } catch {
    output = await exec(
      'getconf GNU_LIBC_VERSION 2>/dev/null || ' +
        'for loader in /lib/ld-musl-*.so.1; do [ ! -e "$loader" ] || { echo musl; break; }; done'
    )
  }
  return `linux-${host.arch}-${parseOrcadLinuxLibc(output)}`
}

/** The server target an assembled bundle was built for. */
export function readOrcadBundleTarget(localOrcadDir: string): ServerTarget {
  const recorded = readFileSync(join(localOrcadDir, ORCAD_SERVER_TARGET_FILENAME), 'utf8').trim()
  const target = SERVER_TARGETS.find((candidate) => candidate === recorded)
  if (!target) {
    throw new Error(`The mantad bundle names no known server target: ${recorded}`)
  }
  return target
}
