/**
 * Deploys mantad onto an empty SSH host and pairs this client with it through a loopback tunnel.
 * The target claim is the resume point: an interrupted deploy leaves the target owned by the
 * environment id it was creating, and the next deploy of that target finishes the same one.
 */
import { getAppEnvironment } from '../../shared/app-environment'
import { randomUUID } from 'node:crypto'
import { assertRuntimeEnvironmentNotReconciling } from '../../shared/runtime-environment-reconciliation-record'
import { listEnvironments } from '../../shared/runtime-environment-store'
import { addManagedOrcadEnvironment } from '../../shared/runtime-environment-managed-mantad-store'
import { redactRuntimeEnvironment } from '../../shared/runtime-environments'
import {
  ORCAD_MANAGED_REMOTE_PORT,
  type OrcadManagedDeployResult
} from '../../shared/mantad-managed-runtime'
import { getManagedOrcadFenceEnvironmentId } from '../../shared/managed-mantad-ssh-owner'
import { runTargetLifecycle } from '../ipc/ssh-target-lifecycle-queue'
import { materializeOrcadArtifact } from './mantad-artifact-materializer'
import {
  closeOrcadManagedTunnel,
  ensureOrcadManagedTunnel,
  startOrcadManagedTunnel
} from './mantad-managed-tunnel'
import { recoverInterruptedOrcadActivation } from './mantad-activation-recovery'
import { readOrcadActivationRecord } from './mantad-activation-record-store'
import { resolveOrcadRemoteContext } from './mantad-remote-context'
import { deployOrcad } from './mantad-remote-deploy'
import { pruneManagedOrcadVersions } from './mantad-managed-version-gc'
import { tunneledOrcadPairingCode } from './mantad-tunneled-pairing'
import { hasRegisteredDirectSshAuthority } from './ssh-target-registry'
import { resolveOrcadMigrationFence } from './mantad-migration-source-fence'
import type { SshTarget } from '../../shared/ssh-types'
import { deployedOrcadTunnelChecks } from './mantad-managed-tunnel-identity'
import {
  isForceableOrcadDeferral,
  managedOrcadSlot,
  probeManagedOrcadReadiness,
  requireManagedOrcadInfrastructure
} from './mantad-managed-runtime-context'

export async function createManagedOrcadEnvironment(
  userDataPath: string,
  args: {
    name: string
    sshTargetId: string
    force?: boolean
    signal?: AbortSignal
    /** Deploying into a target fenced by a migration journal rather than claiming an empty one. */
    migration?: boolean
  }
): Promise<OrcadManagedDeployResult> {
  return runTargetLifecycle(args.sshTargetId, async () => {
    const { connectionManager, targetStore, claims } = requireManagedOrcadInfrastructure()
    const environmentId =
      getManagedOrcadFenceEnvironmentId(targetStore.getTarget(args.sshTargetId)) ?? randomUUID()
    const environments = listEnvironments(userDataPath)
    const registered = environments.find((entry) => entry.id === environmentId)
    if (registered) {
      assertRuntimeEnvironmentNotReconciling(registered)
      if (registered.orcadDeployment?.sshTargetId !== args.sshTargetId) {
        throw new Error('The SSH target is owned by a server that is not deployed on it.')
      }
    }
    if (environments.some((entry) => entry.id !== environmentId && entry.name === args.name)) {
      throw new Error(`A server named "${args.name}" already exists.`)
    }
    if (hasRegisteredDirectSshAuthority(args.sshTargetId)) {
      throw new Error('Disconnect this SSH host before converting it to a managed Manta server.')
    }
    const current = targetStore.getTarget(args.sshTargetId)
    if (args.migration) {
      assertMigrationFence(userDataPath, current, environmentId, args.name)
    }
    const claimed = claims.claim(args.sshTargetId, environmentId, {
      // A migration records itself in its journal, not as a provisioning intent.
      ...(args.migration ? {} : { deployName: args.name }),
      // Why: this deploy's own claim left a provisioning intent or a journal, or registered a server.
      ownerRecorded:
        Boolean(args.migration) || Boolean(current?.orcadProvisioning) || Boolean(registered)
    })
    await claims.flush(args.signal)
    const targetGeneration = claimed.generation
    if (targetGeneration === undefined) {
      throw new Error('The managed Manta SSH registration has no durable generation.')
    }
    if (registered && registered.orcadDeployment?.sshTargetGeneration !== targetGeneration) {
      throw new Error('The saved managed Manta server has a stale SSH target generation.')
    }
    let environmentRegistered = false
    try {
      const connection = await connectionManager.connect(claimed)
      let context = await resolveOrcadRemoteContext(claimed, connection, args.signal)
      const slot = managedOrcadSlot(context, ORCAD_MANAGED_REMOTE_PORT, args.signal)
      const recovery = await recoverInterruptedOrcadActivation(slot)
      if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
        throw new Error(recovery.reason)
      }
      if (recovery.outcome === 'recovered') {
        context = { ...context, activationRecord: await readOrcadActivationRecord(slot) }
      }
      if (registered) {
        environmentRegistered = true
        await ensureOrcadManagedTunnel(userDataPath, registered.id)
        const activeVersion = context.activationRecord.active
        if (!activeVersion) {
          throw new Error('The managed Manta server has no active runtime version.')
        }
        return {
          outcome: 'already-current',
          environment: redactRuntimeEnvironment(registered),
          activeVersion
        }
      }
      const localOrcadDir = await materializeOrcadArtifact(context.serverTarget, {
        signal: args.signal
      })
      const deployResult = await deployOrcad({
        ...slot,
        conn: connection,
        localOrcadDir,
        target: context.serverTarget,
        // Why unknown when a version is active: only the daemon can count its sessions, and
        // a deploy that guessed zero would restart over live terminals.
        census: context.activationRecord.active
          ? { liveSessions: null, startedSinceActivation: null, daemonProtocolVersion: null }
          : { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null },
        force: args.force,
        appVersion: getAppEnvironment().getVersion()
      })
      if (deployResult.outcome === 'installed-not-activated') {
        return {
          outcome: 'deferred',
          candidateVersion: deployResult.fullVersion,
          code: deployResult.code,
          reason: deployResult.reason,
          forceable: isForceableOrcadDeferral(deployResult.code)
        }
      }
      const readiness = await probeManagedOrcadReadiness(
        context,
        localOrcadDir,
        deployResult.fullVersion,
        args.signal
      )
      await pruneManagedOrcadVersions({
        slot,
        serverTarget: context.serverTarget,
        activeVersion: deployResult.fullVersion,
        readiness
      })
      // Why read back: mantad binds another port when the preferred one is taken on the host.
      const tunnel = deployedOrcadTunnelChecks(readiness, () =>
        probeManagedOrcadReadiness(context, localOrcadDir, deployResult.fullVersion, args.signal)
      )
      const localPort = await startOrcadManagedTunnel(
        environmentId,
        claimed,
        connection,
        tunnel.remotePort,
        { ...tunnel, preferredPort: ORCAD_MANAGED_REMOTE_PORT }
      )
      const environment = addManagedOrcadEnvironment(userDataPath, {
        id: environmentId,
        name: args.name,
        pairingCode: tunneledOrcadPairingCode(tunnel.readiness(), localPort),
        orcadDeployment: {
          sshTargetId: claimed.id,
          sshTargetGeneration: targetGeneration,
          localPort,
          remotePort: ORCAD_MANAGED_REMOTE_PORT
        }
      })
      environmentRegistered = true
      return {
        outcome: deployResult.outcome === 'already-active' ? 'already-current' : 'created',
        environment: redactRuntimeEnvironment(environment),
        activeVersion: deployResult.fullVersion
      }
    } finally {
      if (!environmentRegistered) {
        await closeOrcadManagedTunnel(environmentId).catch(() => undefined)
      }
    }
  })
}

function assertMigrationFence(
  userDataPath: string,
  target: SshTarget | undefined,
  environmentId: string,
  name: string
): void {
  const fence = target ? resolveOrcadMigrationFence(userDataPath, target) : null
  if (
    fence?.state !== 'fenced' ||
    fence.cutover.destinationEnvironmentId !== environmentId ||
    fence.cutover.destinationName !== name
  ) {
    throw new Error('orcad_migration_fence_required')
  }
}
