import type { PublicKnownRuntimeEnvironment } from './runtime-environments'
import type { OrcadTerminalCensus } from './mantad-terminal-census'

export const ORCAD_MANAGED_REMOTE_PORT = 6_768

export type OrcadManagedDeferral = {
  outcome: 'deferred'
  candidateVersion: string
  code: string
  reason: string
  /** False when force cannot make the rejected lifecycle transition safe. */
  forceable?: boolean
}

export type OrcadManagedDeployResult =
  | {
      outcome: 'created' | 'updated' | 'already-current'
      environment: PublicKnownRuntimeEnvironment
      activeVersion: string
    }
  | OrcadManagedDeferral

export type OrcadManagedRollbackResult =
  | {
      outcome: 'rolled-back'
      environment: PublicKnownRuntimeEnvironment
      activeVersion: string
      discarded: string[]
    }
  | { outcome: 'refused' | 'failed'; code: string; reason: string }

export type OrcadManagedRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      environment: PublicKnownRuntimeEnvironment
    }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

/** Only a proven `exited` unlinks the server locally; anything less keeps it linked. */
export type OrcadManagedStopResult =
  | {
      outcome: 'unlinked'
      verdict: 'exited'
      environmentId: string
      sshTargetId: string
      stoppedVersion: string | null
      retirement: 'retired' | 'live' | 'unverifiable' | null
    }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

export type OrcadManagedCancelStopResult =
  | { outcome: 'none' }
  /** The stop was withdrawn before mantad acted on it; the server keeps serving. */
  | { outcome: 'canceled'; activeVersion: string }
  /** mantad had already exited; finish with stop to unlink the server. */
  | { outcome: 'already-stopped' }
  | { outcome: 'refused'; verdict: 'live' | 'unverifiable'; code: string; reason: string }

export type OrcadManagedRuntimeStatus = {
  environmentId: string
  sshTargetId: string
  activeVersion: string | null
  previousVersion: string | null
  activatedAt: string | null
  rollbackAvailable: boolean
  recovery:
    | {
        operation: 'activate'
        phase: 'prepared' | 'incumbent-stopped' | 'snapshot-captured' | 'candidate-ready'
        version: string
        startedAt: string
      }
    | {
        operation: 'rollback'
        phase:
          | 'prepared'
          | 'incumbent-stopped'
          | 'rescue-captured'
          | 'rollback-state-restored'
          | 'target-ready'
        version: string
        startedAt: string
      }
    | {
        operation: 'decommission'
        phase: 'prepared' | 'stop-dispatched' | 'process-exited'
        version: string
        startedAt: string
      }
    | null
  /** Terminals the daemon runs; `null` counts are unverifiable and block updates and stops. */
  terminals: OrcadTerminalCensus
  /** The last update this client deferred for this server, cleared once one goes through. */
  deferredUpdate: (OrcadManagedDeferral & { deferredAt: string }) | null
}
