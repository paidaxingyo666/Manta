/**
 * Puts the pinned Node beside the mantad slots, at `runtimes/node-<executableSha256>/bin/node`
 * (design D2/D5), where `selectOrcadSlotRuntimeCommand` resolves a slot's `.runtime-node`.
 *
 * The official archive is uploaded as published and extracted on the host; the executable's
 * hash is checked there before it is published. Store-wide GC and the fallback ladder are
 * Phase 2: nothing here deletes a runtime.
 */
import { randomBytes } from 'node:crypto'
import { copyFile, link, mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  NODE_RUNTIME_ASSETS,
  NODE_RUNTIME_PIN,
  nodeRuntimeExecutablePath,
  type ServerTarget
} from '../../shared/node-runtime-pin'
import {
  ORCAD_NODE_RUNTIME_DIR_PREFIX,
  ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE,
  ORCAD_RUNTIMES_DIRNAME
} from '../../shared/mantad-artifacts'
import type { SshConnection } from './ssh-connection'
import { shellEscape } from './ssh-connection-utils'
import { execCommand } from './ssh-relay-deploy-helpers'
import { uploadRelayDirectory } from './ssh-relay-install-transfers'
import { joinRemotePath, remoteDirname, type RemoteHostPlatform } from './ssh-remote-platform'
import { assertPosixOrcadHost } from './mantad-remote-host-support'

export const REMOTE_NODE_RUNTIME_READY = 'ORCA_NODE_RUNTIME_READY'
export const REMOTE_NODE_RUNTIME_MISSING = 'ORCA_NODE_RUNTIME_MISSING'
const VERIFIED_MARKER = '.verified'

/** The runtime directory a slot at `slotDir` names; the selector computes the same path. */
export function remoteNodeRuntimeDir(
  host: RemoteHostPlatform,
  slotDir: string,
  target: ServerTarget
): string {
  return joinRemotePath(
    host,
    remoteDirname(slotDir.replace(/\/+$/, ''), host),
    ORCAD_RUNTIMES_DIRNAME,
    `${ORCAD_NODE_RUNTIME_DIR_PREFIX}${NODE_RUNTIME_ASSETS[target].executableSha256}`
  )
}

// Why both tools: GNU/busybox ship sha256sum, macOS ships shasum; either prints the digest first.
function sha256Of(path: string): string {
  return `{ sha256sum ${path} 2>/dev/null || shasum -a 256 ${path}; } | cut -d' ' -f1`
}

/** Ready only when the executable hashes to the pin and reports the pinned version. */
export function probeRemoteNodeRuntimeCommand(
  host: RemoteHostPlatform,
  runtimeDir: string,
  target: ServerTarget
): string {
  assertPosixOrcadHost(host)
  const executable = shellEscape(
    joinRemotePath(host, runtimeDir, ...ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE.split('/'))
  )
  const verified = shellEscape(joinRemotePath(host, runtimeDir, VERIFIED_MARKER))
  return (
    `if [ -f ${verified} ] && [ -x ${executable} ] && ` +
    `[ "$(${sha256Of(executable)})" = ${shellEscape(NODE_RUNTIME_ASSETS[target].executableSha256)} ]; ` +
    `then echo ${REMOTE_NODE_RUNTIME_READY}; else echo ${REMOTE_NODE_RUNTIME_MISSING}; fi`
  )
}

/**
 * Extract, verify, self-test and publish. The executable is renamed into place file-by-file,
 * so a concurrent installer of the same pin only ever replaces identical verified bytes.
 */
export function promoteRemoteNodeRuntimeCommand(
  host: RemoteHostPlatform,
  args: {
    stageDir: string
    archive: string
    runtimeDir: string
    target: ServerTarget
    token: string
  }
): string {
  assertPosixOrcadHost(host)
  const asset = NODE_RUNTIME_ASSETS[args.target]
  const member = nodeRuntimeExecutablePath(args.target, asset.archive)
  const stage = shellEscape(args.stageDir)
  const extracted = shellEscape(joinRemotePath(host, args.stageDir, ...member.split('/')))
  const binDir = shellEscape(joinRemotePath(host, args.runtimeDir, 'bin'))
  const temporary = shellEscape(joinRemotePath(host, args.runtimeDir, 'bin', `node.${args.token}`))
  const executable = shellEscape(
    joinRemotePath(host, args.runtimeDir, ...ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE.split('/'))
  )
  const verified = shellEscape(joinRemotePath(host, args.runtimeDir, VERIFIED_MARKER))
  return [
    `cd ${stage} || exit 1`,
    `tar -xzf ${shellEscape(joinRemotePath(host, args.stageDir, args.archive))} ${shellEscape(member)} || { echo ORCA_NODE_RUNTIME_EXTRACT_FAILED; exit 1; }`,
    `[ "$(${sha256Of(extracted)})" = ${shellEscape(asset.executableSha256)} ] || { echo ORCA_NODE_RUNTIME_HASH_MISMATCH; exit 1; }`,
    `chmod 755 ${extracted}`,
    // Why run it: executing is the only reliable check for noexec mounts and a wrong libc.
    `[ "$(${extracted} --version 2>&1)" = ${shellEscape(`v${NODE_RUNTIME_PIN.version}`)} ] || { echo ORCA_NODE_RUNTIME_SELFTEST_FAILED; exit 1; }`,
    `mkdir -p ${binDir}`,
    `mv -f ${extracted} ${temporary}`,
    `mv -f ${temporary} ${executable}`,
    `: > ${verified}`,
    `echo ${REMOTE_NODE_RUNTIME_READY}`
  ].join(' && ')
}

function exec(conn: SshConnection, command: string, signal?: AbortSignal): Promise<string> {
  return execCommand(conn, command, { signal })
}

/** Ensures the slot's runtime exists on the host; uploads the pinned archive only when needed. */
export async function ensureRemoteOrcadNodeRuntime(options: {
  conn: SshConnection
  host: RemoteHostPlatform
  slotDir: string
  target: ServerTarget
  /** The locally verified pinned archive (pinned-runtime-materializer). */
  archivePath: () => Promise<string>
  signal?: AbortSignal
}): Promise<void> {
  const { conn, host, target, signal } = options
  const runtimeDir = remoteNodeRuntimeDir(host, options.slotDir, target)
  const probe = await exec(conn, probeRemoteNodeRuntimeCommand(host, runtimeDir, target), signal)
  if (probe.trim() === REMOTE_NODE_RUNTIME_READY) {
    return
  }
  const archivePath = await options.archivePath()
  const token = randomBytes(8).toString('hex')
  const stageDir = joinRemotePath(
    host,
    remoteDirname(runtimeDir, host),
    `.stage-${basename(runtimeDir)}-${token}`
  )
  const localStage = await mkdtemp(join(dirname(archivePath), '.runtime-upload-'))
  try {
    const archive = basename(archivePath)
    await link(archivePath, join(localStage, archive)).catch(() =>
      copyFile(archivePath, join(localStage, archive))
    )
    await exec(conn, `mkdir -p ${shellEscape(stageDir)}`, signal)
    await uploadRelayDirectory(conn, localStage, stageDir, host, { signal })
    const promoted = await exec(
      conn,
      promoteRemoteNodeRuntimeCommand(host, { stageDir, archive, runtimeDir, target, token }),
      signal
    )
    if (promoted.trim().split('\n').at(-1) !== REMOTE_NODE_RUNTIME_READY) {
      throw new Error(`The host did not verify the pinned Node runtime: ${promoted.trim()}`)
    }
  } finally {
    await rm(localStage, { recursive: true, force: true }).catch(() => {})
    await exec(conn, `rm -rf ${shellEscape(stageDir)}`).catch(() => {})
  }
}
