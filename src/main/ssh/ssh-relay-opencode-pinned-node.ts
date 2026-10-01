import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import { NODE_RUNTIME_ASSETS, type ServerTarget } from '../../shared/node-runtime-pin'
import type { SshConnection } from './ssh-connection'
import { resolveOrcadDeploymentTarget } from './mantad-deployment-target'
import { ensureRemoteOrcadNodeRuntime, type RemoteRuntimeStep } from './mantad-remote-node-runtime'
import { materializeNodeRuntimeArchive } from './pinned-runtime-materializer'
import type { RemoteHostPlatform } from './ssh-remote-platform'

const DOWNLOAD_TIMEOUT_MS = 180_000
const downloads = new Map<string, Promise<string>>()

/**
 * The pinned Node for hosts whose own Node cannot read OpenCode's database (design D4a). Every
 * host, Windows included, installs it into the shared runtimes/ store as the official archive
 * with a `.verified` marker; nothing here touches vault-sqlite/, which old relays' references
 * still name. `runtimeSha256` is the ref the relay dir must carry so store GC keeps it.
 */
export async function preparePinnedNodeForVault(options: {
  conn: SshConnection
  host: RemoteHostPlatform
  relayDir: string
  cacheRoot?: string
  signal: AbortSignal
  exec: (command: string) => Promise<string>
  remote: RemoteRuntimeStep
}): Promise<{ executable: string; runtimeSha256: string }> {
  const { conn, host, signal, exec } = options
  const target = await resolveOrcadDeploymentTarget({ conn, host, signal, exec })
  const cacheRoot =
    options.cacheRoot ?? join(getAppEnvironment().getPath('userData'), 'mantad-artifacts')
  const { executable } = await ensureRemoteOrcadNodeRuntime({
    conn,
    host,
    slotDir: options.relayDir,
    target,
    archivePath: () => cachedArchive(target, cacheRoot, signal),
    signal,
    remoteStep: options.remote
  })
  return { executable, runtimeSha256: NODE_RUNTIME_ASSETS[target].executableSha256 }
}

function cachedArchive(
  target: ServerTarget,
  cacheRoot: string,
  signal: AbortSignal
): Promise<string> {
  const key = `${cacheRoot}\0${target}`
  let pending = downloads.get(key)
  if (!pending) {
    pending = materializeNodeRuntimeArchive(target, cacheRoot, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    }).finally(() => downloads.delete(key))
    downloads.set(key, pending)
  }
  return waitForPromiseWithSignal(pending, signal)
}
