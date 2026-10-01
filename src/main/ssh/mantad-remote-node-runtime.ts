/**
 * Puts the pinned Node beside the mantad slots, at `runtimes/node-<executableSha256>/bin/node`
 * (design D2/D5), where `selectOrcadSlotRuntimeCommand` resolves a slot's `.runtime-node`.
 * The OpenCode vault reader uses the same store on SSH and WSL hosts (design D4a).
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
import { isUnconfirmedSshCommandTermination } from './ssh-relay-exec-command'
import { uploadRelayDirectory } from './ssh-relay-install-transfers'
import { joinRemotePath, remoteDirname, type RemoteHostPlatform } from './ssh-remote-platform'
import { assertPosixOrcadHost } from './mantad-remote-host-support'

export const REMOTE_NODE_RUNTIME_READY = 'ORCA_NODE_RUNTIME_READY'
export const REMOTE_NODE_RUNTIME_MISSING = 'ORCA_NODE_RUNTIME_MISSING'
const VERIFIED_MARKER = '.verified'

/** `<storeParent>/runtimes/node-<executableSha256>`, the one host layout (design D5). */
export function nodeRuntimeStoreDir(
  host: RemoteHostPlatform,
  storeParent: string,
  target: ServerTarget
): string {
  return joinRemotePath(
    host,
    storeParent,
    ORCAD_RUNTIMES_DIRNAME,
    `${ORCAD_NODE_RUNTIME_DIR_PREFIX}${NODE_RUNTIME_ASSETS[target].executableSha256}`
  )
}

/**
 * The runtime directory beside a version dir (an mantad slot or a relay install); the slot
 * selector computes the same path, and the vault reader shares the store.
 */
export function remoteNodeRuntimeDir(
  host: RemoteHostPlatform,
  slotDir: string,
  target: ServerTarget
): string {
  return nodeRuntimeStoreDir(host, remoteDirname(slotDir.replace(/\/+$/, ''), host), target)
}

/** The executable inside a POSIX runtime directory. */
export function posixNodeRuntimeExecutable(host: RemoteHostPlatform, runtimeDir: string): string {
  return joinRemotePath(host, runtimeDir, ...ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE.split('/'))
}

/** A per-installer stage beside the runtime; its dot prefix keeps it out of `node-*` listings. */
export function nodeRuntimeStageDir(
  host: RemoteHostPlatform,
  runtimeDir: string,
  token: string
): string {
  return joinRemotePath(
    host,
    remoteDirname(runtimeDir, host),
    `.stage-${basename(runtimeDir)}-${token}`
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
  const executable = shellEscape(posixNodeRuntimeExecutable(host, runtimeDir))
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
  const executable = shellEscape(posixNodeRuntimeExecutable(host, args.runtimeDir))
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

/**
 * Copies the archive at `$1` (a path the host can already read, e.g. a WSL view of the
 * client's cache) into a fresh stage, promotes it, and removes the stage whatever happens.
 */
export function installNodeRuntimeFromHostArchiveCommand(
  host: RemoteHostPlatform,
  args: { runtimeDir: string; archive: string; target: ServerTarget; token: string }
): string {
  const stageDir = nodeRuntimeStageDir(host, args.runtimeDir, args.token)
  const stage = shellEscape(stageDir)
  const promote = promoteRemoteNodeRuntimeCommand(host, { ...args, stageDir })
  const copy = `cp -- "$1" ${shellEscape(joinRemotePath(host, stageDir, args.archive))}`
  // Subshell: promote's `exit 1` must still reach the stage cleanup.
  return `(umask 077 && mkdir -p ${stage} && ${copy} && ${promote}); status=$?; rm -rf ${stage}; exit $status`
}

export type RemoteRuntimeStep = <T>(operation: () => Promise<T>) => Promise<T>

const runDirectly: RemoteRuntimeStep = (operation) => operation()

/**
 * Ensures the runtime beside `slotDir` exists on the host, uploading the pinned archive only
 * when needed, and returns its executable.
 */
export async function ensureRemoteOrcadNodeRuntime(options: {
  conn: SshConnection
  host: RemoteHostPlatform
  slotDir: string
  target: ServerTarget
  /** The locally verified pinned archive (pinned-runtime-materializer). */
  archivePath: () => Promise<string>
  signal?: AbortSignal
  /** Wraps each host round trip, so a caller can tell an unconfirmed channel from a local failure. */
  remoteStep?: RemoteRuntimeStep
}): Promise<string> {
  const { conn, host, target, signal } = options
  const remoteStep = options.remoteStep ?? runDirectly
  const exec = (command: string, commandSignal?: AbortSignal): Promise<string> =>
    remoteStep(() => execCommand(conn, command, { signal: commandSignal }))
  const runtimeDir = remoteNodeRuntimeDir(host, options.slotDir, target)
  const executable = posixNodeRuntimeExecutable(host, runtimeDir)
  const probe = await exec(probeRemoteNodeRuntimeCommand(host, runtimeDir, target), signal)
  if (probe.trim() === REMOTE_NODE_RUNTIME_READY) {
    return executable
  }
  const archivePath = await options.archivePath()
  const token = randomBytes(8).toString('hex')
  const stageDir = nodeRuntimeStageDir(host, runtimeDir, token)
  const localStage = await mkdtemp(join(dirname(archivePath), '.runtime-upload-'))
  let stageUnconfirmed = false
  try {
    const archive = basename(archivePath)
    await link(archivePath, join(localStage, archive)).catch(() =>
      copyFile(archivePath, join(localStage, archive))
    )
    await exec(`mkdir -p ${shellEscape(stageDir)}`, signal)
    await remoteStep(() => uploadRelayDirectory(conn, localStage, stageDir, host, { signal }))
    const promoted = await exec(
      promoteRemoteNodeRuntimeCommand(host, { stageDir, archive, runtimeDir, target, token }),
      signal
    )
    if (promoted.trim().split('\n').at(-1) !== REMOTE_NODE_RUNTIME_READY) {
      throw new Error(`The host did not verify the pinned Node runtime: ${promoted.trim()}`)
    }
    return executable
  } catch (error) {
    stageUnconfirmed = isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    await rm(localStage, { recursive: true, force: true }).catch(() => {})
    // A transfer that may still be writing keeps its stage; loss of contact is not an exit.
    if (!stageUnconfirmed) {
      await exec(`rm -rf ${shellEscape(stageDir)}`).catch(() => {})
    }
  }
}
