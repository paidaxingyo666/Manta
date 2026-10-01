/**
 * Plan a relay launch on Manta's pinned Node with the mantad slot's prebuilt addons, instead
 * of the host's Node plus a host-side npm install (design D5, D6 rung A, D8.1).
 *
 * Opt-in per host (`SshTarget.remoteRuntime`), POSIX hosts only. Anything this module cannot
 * establish on the client, and every classified refusal from the host, falls back to the
 * legacy host-Node path with a logged reason.
 */
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { NODE_RUNTIME_ASSETS, type ServerTarget } from '../../shared/node-runtime-pin'
import {
  ORCAD_NODE_PTY_JS_ARTIFACTS,
  ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE,
  ORCAD_PARCEL_WATCHER_ENTRY,
  ORCAD_PARCEL_WATCHER_NATIVE,
  orcadNodePtyNativeArtifacts
} from '../../shared/mantad-artifacts'
import {
  DEFAULT_SSH_REMOTE_RUNTIME,
  SSH_REMOTE_RUNTIMES,
  type SshRemoteRuntime,
  type SshTarget
} from '../../shared/ssh-types'
import { materializeOrcadArtifact } from './mantad-artifact-materializer'
import {
  resolveOrcadDeploymentTargetFacts,
  UnidentifiedHostLibcError,
  type GlibcVersion
} from './mantad-deployment-target'
import { remoteNodeRuntimeDir } from './mantad-remote-node-runtime'
import { fileSha256, materializeNodeRuntimeArchive } from './pinned-runtime-materializer'
import type { SshConnection } from './ssh-connection'
import { PINNED_RUNTIME_REFUSALS, type PinnedRuntimeRefusal } from './ssh-relay-runtime-self-test'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'

/** Content-keyed like ripgrep's refs, so runtime GC can find holders without a new concept (D5). */
export const RELAY_RUNTIME_REF_PREFIX = '.runtime-ref-node-'
/** Official linux builds of the pinned Node need glibc 2.28; older hosts are rung B/C territory. */
export const PINNED_NODE_GLIBC_FLOOR: GlibcVersion = { major: 2, minor: 28 }
/** Developer override when no per-host setting is saved. */
export const SSH_REMOTE_RUNTIME_ENV = 'ORCA_SSH_REMOTE_RUNTIME'

export function resolveSshRemoteRuntime(
  target: Pick<SshTarget, 'remoteRuntime'> | undefined,
  env: NodeJS.ProcessEnv = process.env
): SshRemoteRuntime {
  if (target?.remoteRuntime) {
    return target.remoteRuntime
  }
  const fromEnv = SSH_REMOTE_RUNTIMES.find((runtime) => runtime === env[SSH_REMOTE_RUNTIME_ENV])
  return fromEnv ?? DEFAULT_SSH_REMOTE_RUNTIME
}

export function isGlibcBelow(version: GlibcVersion, floor: GlibcVersion): boolean {
  return (
    version.major < floor.major || (version.major === floor.major && version.minor < floor.minor)
  )
}

/**
 * Folds the runtime and addon bytes into the relay's content version, so a pinned build and a
 * host-Node build of the same relay never share a directory or a socket (D8.1).
 */
export function pinnedNodeRelayFullVersion(
  baseVersion: string,
  executableSha256: string,
  addonDigest: string
): string {
  const match = /^(v?[0-9]+\.[0-9]+\.[0-9]+)(?:\+[0-9a-f]+)?$/.exec(baseVersion)
  if (!match) {
    throw new Error(`Relay version is not <semver>[+<hex>]: ${baseVersion}`)
  }
  const digest = createHash('sha256')
    .update(`${baseVersion}\0node-runtime\0${executableSha256}\0${addonDigest}`)
    .digest('hex')
  return `${match[1]}+${digest.slice(0, 12)}`
}

export function pinnedRelayAddonFiles(target: ServerTarget): string[] {
  return [
    ...ORCAD_NODE_PTY_JS_ARTIFACTS,
    ...orcadNodePtyNativeArtifacts(target),
    ORCAD_PARCEL_WATCHER_ENTRY,
    ORCAD_PARCEL_WATCHER_NATIVE
  ]
}

export type PinnedRelayAddons = {
  /** Upload this directory's contents into the relay version dir. */
  dir: string
  digest: string
  dispose: () => Promise<void>
}

/** Copies this target's node-pty and watcher out of a verified mantad slot, beside a runtime ref. */
export async function stagePinnedRelayAddons(
  orcadDir: string,
  target: ServerTarget,
  stagingParent: string = tmpdir()
): Promise<PinnedRelayAddons> {
  const dir = await mkdtemp(join(stagingParent, 'orca-relay-addons-'))
  try {
    const hash = createHash('sha256')
    for (const file of pinnedRelayAddonFiles(target).sort()) {
      const source = join(orcadDir, ...file.split('/'))
      const sha = await fileSha256(source)
      if (!sha) {
        throw new Error(`The mantad slot for ${target} has no ${file}`)
      }
      const destination = join(dir, ...file.split('/'))
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source, destination)
      if (file.endsWith('/spawn-helper')) {
        await chmod(destination, 0o755)
      }
      hash.update(`${file}\0${sha}\n`)
    }
    const executableSha256 = NODE_RUNTIME_ASSETS[target].executableSha256
    await writeFile(
      join(dir, `${RELAY_RUNTIME_REF_PREFIX}${executableSha256}`),
      `${executableSha256}\n`
    )
    return {
      dir,
      digest: hash.digest('hex'),
      dispose: () => rm(dir, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

/** `~/.manta-remote/runtimes/node-<sha>/bin/node`, the sibling store mantad slots use too. */
export function pinnedRelayNodePath(
  host: RemoteHostPlatform,
  remoteRelayDir: string,
  target: ServerTarget
): string {
  return joinRemotePath(
    host,
    remoteNodeRuntimeDir(host, remoteRelayDir, target),
    ...ORCAD_NODE_RUNTIME_POSIX_EXECUTABLE.split('/')
  )
}

export type PinnedRelayPlan = {
  kind: 'pinned-node'
  target: ServerTarget
  glibc: GlibcVersion | null
  fullVersion: string
  addons: PinnedRelayAddons
  runtimeArchive: () => Promise<string>
}

export type RelayRuntimeFallbackReason =
  | PinnedRuntimeRefusal
  | 'windows_host_unsupported'
  | 'target_unresolved'
  | 'artifacts_unavailable'

export type HostNodeRelayPlan = { kind: 'host-node'; fallbackReason?: RelayRuntimeFallbackReason }

/** The pinned path cannot run on this host or client; the deploy retries on the host's Node. */
export class PinnedRelayFallbackError extends Error {
  constructor(
    readonly reason: RelayRuntimeFallbackReason,
    readonly detail: string
  ) {
    super(`Manta's pinned Node relay is unavailable (${reason}): ${detail}`)
    this.name = 'PinnedRelayFallbackError'
  }
}

export function isPinnedRuntimeRefusal(reason: string): reason is PinnedRuntimeRefusal {
  return PINNED_RUNTIME_REFUSALS.some((refusal) => refusal === reason)
}

// Why in memory only: the persisted per-host ladder cache is a later slice (D6).
const refusals = new Map<string, PinnedRuntimeRefusal>()

function refusalKey(targetId: string, target: ServerTarget): string {
  return `${targetId}\0${NODE_RUNTIME_ASSETS[target].executableSha256}`
}

export function recordPinnedRuntimeRefusal(
  targetId: string,
  target: ServerTarget,
  refusal: PinnedRuntimeRefusal
): void {
  refusals.set(refusalKey(targetId, target), refusal)
}

export function resetPinnedRuntimeRefusalsForTests(): void {
  refusals.clear()
}

export function logPinnedRelayFallback(
  reason: RelayRuntimeFallbackReason,
  detail: string
): HostNodeRelayPlan {
  console.warn(`[ssh-relay] Pinned Node relay unavailable (${reason}): ${detail}; using host Node`)
  return { kind: 'host-node', fallbackReason: reason }
}

export async function planPinnedNodeRelay(options: {
  conn: SshConnection
  host: RemoteHostPlatform
  baseVersion: string
  targetId: string
  signal?: AbortSignal
  materializeOrcad?: (target: ServerTarget, signal?: AbortSignal) => Promise<string>
  runtimeCacheRoot?: () => string
}): Promise<PinnedRelayPlan | HostNodeRelayPlan> {
  const { host, signal } = options
  if (host.os === 'win32') {
    return logPinnedRelayFallback(
      'windows_host_unsupported',
      'Windows hosts keep the host-Node relay for now'
    )
  }
  let facts
  try {
    facts = await resolveOrcadDeploymentTargetFacts({ conn: options.conn, host, signal })
  } catch (error) {
    // Why only an answered probe: a lost channel says nothing about the host, and descending
    // would launch a second daemon beside a running pinned one, stranding its sessions.
    if (!(error instanceof UnidentifiedHostLibcError)) {
      throw error
    }
    return logPinnedRelayFallback('target_unresolved', error.message)
  }
  const { target, glibc } = facts
  const cached = refusals.get(refusalKey(options.targetId, target))
  if (cached) {
    return logPinnedRelayFallback(cached, 'refused earlier this session')
  }
  if (glibc && isGlibcBelow(glibc, PINNED_NODE_GLIBC_FLOOR)) {
    recordPinnedRuntimeRefusal(options.targetId, target, 'libc_floor')
    return logPinnedRelayFallback(
      'libc_floor',
      `host glibc ${glibc.major}.${glibc.minor} is below 2.28`
    )
  }
  let addons: PinnedRelayAddons
  try {
    const materialize =
      options.materializeOrcad ?? ((t, s) => materializeOrcadArtifact(t, { signal: s }))
    addons = await stagePinnedRelayAddons(await materialize(target, signal), target)
  } catch (error) {
    signal?.throwIfAborted()
    return logPinnedRelayFallback(
      'artifacts_unavailable',
      error instanceof Error ? error.message : String(error)
    )
  }
  const cacheRoot =
    options.runtimeCacheRoot ??
    ((): string => join(getAppEnvironment().getPath('userData'), 'mantad-artifacts'))
  let fullVersion: string
  try {
    fullVersion = pinnedNodeRelayFullVersion(
      options.baseVersion,
      NODE_RUNTIME_ASSETS[target].executableSha256,
      addons.digest
    )
  } catch (error) {
    await addons.dispose()
    throw error
  }
  return {
    kind: 'pinned-node',
    target,
    glibc,
    fullVersion,
    addons,
    runtimeArchive: () =>
      materializeNodeRuntimeArchive(target, cacheRoot(), { signal }).catch((error: unknown) => {
        signal?.throwIfAborted()
        throw new PinnedRelayFallbackError(
          'artifacts_unavailable',
          error instanceof Error ? error.message : String(error)
        )
      })
  }
}
