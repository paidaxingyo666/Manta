import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import { NODE_RUNTIME_ASSETS, type ServerTarget } from '../../shared/node-runtime-pin'
import { ORCAD_NODE_RUNTIME_WINDOWS_EXECUTABLE } from '../../shared/mantad-artifacts'
import type { SshConnection } from './ssh-connection'
import { resolveOrcadDeploymentTarget } from './mantad-deployment-target'
import {
  ensureRemoteOrcadNodeRuntime,
  remoteNodeRuntimeDir,
  type RemoteRuntimeStep
} from './mantad-remote-node-runtime'
import {
  materializeCachedNodeRuntime,
  materializeNodeRuntimeArchive
} from './pinned-runtime-materializer'
import { isWindowsRemoteHost, joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import {
  parseOpenCodeRuntimeResult,
  probeOpenCodeRuntimeCacheCommand
} from './ssh-relay-opencode-runtime-commands'

const DOWNLOAD_TIMEOUT_MS = 180_000
const downloads = new Map<string, Promise<string>>()

/** A verified local executable the caller still has to upload and promote on the host. */
export type PinnedNodeVaultUpload = { localRuntime: string; expectedHash: string }

/**
 * The pinned Node for hosts whose own Node cannot read OpenCode's database (design D4a).
 * POSIX hosts get it in the shared runtimes/ store; nothing here touches vault-sqlite/, which
 * old relays' references still name.
 */
export async function preparePinnedNodeForVault(options: {
  conn: SshConnection
  host: RemoteHostPlatform
  nodePath: string
  relayDir: string
  cacheRoot?: string
  referencePath: string
  signal: AbortSignal
  exec: (command: string) => Promise<string>
  remote: RemoteRuntimeStep
}): Promise<{ executable: string; upload?: PinnedNodeVaultUpload }> {
  const { conn, host, signal, exec } = options
  const target = await resolveOrcadDeploymentTarget({ conn, host, signal, exec })
  const cacheRoot =
    options.cacheRoot ?? join(getAppEnvironment().getPath('userData'), 'mantad-artifacts')
  if (!isWindowsRemoteHost(host)) {
    const { executable } = await ensureRemoteOrcadNodeRuntime({
      conn,
      host,
      slotDir: options.relayDir,
      target,
      archivePath: () => cachedRuntime('archive', target, cacheRoot, signal),
      signal,
      remoteStep: options.remote
    })
    return { executable }
  }
  // Why a bare executable: Windows hosts get archive extraction with the upload path (design D5).
  const expectedHash = NODE_RUNTIME_ASSETS[target].executableSha256
  const executable = joinRemotePath(
    host,
    remoteNodeRuntimeDir(host, options.relayDir, target),
    ORCAD_NODE_RUNTIME_WINDOWS_EXECUTABLE
  )
  const cached = parseOpenCodeRuntimeResult(
    await exec(
      probeOpenCodeRuntimeCacheCommand({
        host,
        nodePath: options.nodePath,
        executable,
        expectedHash,
        reference: options.referencePath
      })
    )
  )
  if (cached.status === 'ready' && cached.executable) {
    return { executable: cached.executable }
  }
  if (cached.status !== 'missing') {
    throw new Error('The host did not confirm its SQLite runtime cache.')
  }
  const localRuntime = await cachedRuntime('executable', target, cacheRoot, signal)
  signal.throwIfAborted()
  return { executable, upload: { localRuntime, expectedHash } }
}

function cachedRuntime(
  kind: 'archive' | 'executable',
  target: ServerTarget,
  cacheRoot: string,
  signal: AbortSignal
): Promise<string> {
  const key = `${cacheRoot}\0${kind}\0${target}`
  let pending = downloads.get(key)
  if (!pending) {
    const materialize =
      kind === 'archive' ? materializeNodeRuntimeArchive : materializeCachedNodeRuntime
    pending = materialize(target, cacheRoot, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    }).finally(() => downloads.delete(key))
    downloads.set(key, pending)
  }
  return waitForPromiseWithSignal(pending, signal)
}
