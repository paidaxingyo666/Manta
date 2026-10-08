/** What a client learns from decommissioning a managed mantad. */
import type { OrcadManagedRefusal } from './mantad-managed-runtime'
import type { OrcadDaemonRetirementVerdict } from './mantad-stop-request'

export type OrcadDecommissionResult =
  | {
      outcome: 'decommissioned'
      version: string
      /** The daemon's fate: `retired`, or kept with its terminals (`live`/`unverifiable`). */
      retirement: OrcadDaemonRetirementVerdict
    }
  | OrcadManagedRefusal
