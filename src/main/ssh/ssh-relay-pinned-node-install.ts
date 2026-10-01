/** Host-side steps of the pinned-Node relay install: the runtime store and the pre-launch self-test. */
import { orcadNodePtyNativeArtifacts } from '../../shared/mantad-artifacts'
import {
  ensureRemoteOrcadNodeRuntime,
  remoteNodeRuntimeDir,
  remoteNodeRuntimePresentCommand,
  RemoteNodeRuntimeSelfTestError,
  REMOTE_NODE_RUNTIME_READY
} from './mantad-remote-node-runtime'
import type { SshConnection } from './ssh-connection'
import { shellEscape } from './ssh-connection-utils'
import { execCommand } from './ssh-relay-deploy-helpers'
import { isUnconfirmedSshCommandTermination } from './ssh-relay-exec-command'
import {
  isPinnedRuntimeRefusal,
  PinnedRelayFallbackError,
  pinnedRelayNodePath,
  recordPinnedRuntimeRefusal,
  type PinnedRelayPlan
} from './ssh-relay-pinned-node'
import {
  classifyPinnedRuntimeFailure,
  runPinnedRuntimeSelfTest
} from './ssh-relay-runtime-self-test'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'

type PinnedInstallContext = {
  conn: SshConnection
  host: RemoteHostPlatform
  remoteRelayDir: string
  plan: PinnedRelayPlan
  targetId: string
  signal?: AbortSignal
}

function refuse(context: PinnedInstallContext, error: PinnedRelayFallbackError): never {
  if (isPinnedRuntimeRefusal(error.reason)) {
    recordPinnedRuntimeRefusal(context.targetId, context.plan.target, error.reason)
  }
  throw error
}

/**
 * The warm path only checks the verified marker; hashing ~120 MiB on every reconnect would
 * spend the warm-reconnect budget (design D10 G2.6). A cold install verifies in full.
 */
export async function ensurePinnedRelayRuntime(
  context: PinnedInstallContext,
  relayAlreadyInstalled: boolean
): Promise<void> {
  const { conn, host, remoteRelayDir, plan, signal } = context
  if (relayAlreadyInstalled) {
    const runtimeDir = remoteNodeRuntimeDir(host, remoteRelayDir, plan.target)
    const present = await execCommand(conn, remoteNodeRuntimePresentCommand(host, runtimeDir), {
      signal
    })
    if (present.trim() === REMOTE_NODE_RUNTIME_READY) {
      return
    }
  }
  try {
    await ensureRemoteOrcadNodeRuntime({
      conn,
      host,
      slotDir: remoteRelayDir,
      target: plan.target,
      archivePath: plan.runtimeArchive,
      signal
    })
  } catch (error) {
    if (error instanceof PinnedRelayFallbackError) {
      refuse(context, error)
    }
    if (error instanceof RemoteNodeRuntimeSelfTestError) {
      const refusal = classifyPinnedRuntimeFailure(error.exitStatus, error.output)
      if (refusal) {
        refuse(context, new PinnedRelayFallbackError(refusal, error.message))
      }
    }
    throw error
  }
}

/** Runs after the payload is promoted and before `.install-complete`, so a refused dir never completes. */
export async function verifyPinnedRelayInstall(context: PinnedInstallContext): Promise<void> {
  const { conn, host, remoteRelayDir, plan, signal } = context
  const spawnHelpers = orcadNodePtyNativeArtifacts(plan.target).filter((artifact) =>
    artifact.endsWith('/spawn-helper')
  )
  if (spawnHelpers.length > 0) {
    // SFTP drops executable modes; node-pty posix_spawns this helper on macOS.
    await execCommand(
      conn,
      `chmod 755 ${spawnHelpers
        .map((artifact) =>
          shellEscape(joinRemotePath(host, remoteRelayDir, ...artifact.split('/')))
        )
        .join(' ')}`,
      { signal }
    )
  }
  const nodePath = pinnedRelayNodePath(host, remoteRelayDir, plan.target)
  const verdict = await runPinnedRuntimeSelfTest(conn, remoteRelayDir, nodePath, signal)
  switch (verdict.verdict) {
    case 'passed':
      console.log(
        `[ssh-relay] Pinned Node self-test passed at ${remoteRelayDir} (${verdict.report.node}, glibc ${verdict.report.glibcVersionRuntime ?? 'n/a'})`
      )
      return
    case 'refused':
      refuse(context, new PinnedRelayFallbackError(verdict.refusal, verdict.detail))
      break
    case 'unverifiable':
      // Why rethrow the cause: an unconfirmed teardown must keep the install lock held.
      if (isUnconfirmedSshCommandTermination(verdict.cause)) {
        throw verdict.cause
      }
      throw new Error(
        `The pinned Node self-test at ${remoteRelayDir} is unverifiable; retrying on the next connect: ${verdict.detail}`
      )
    case 'failed':
      throw new Error(`The pinned Node self-test at ${remoteRelayDir} failed: ${verdict.detail}`)
  }
}
