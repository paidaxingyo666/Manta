/** Withdrawing a managed stop request that the running mantad has not acted on yet. */
import { rmSync } from 'node:fs'
import type {
  OrcadManagedStopCancellation,
  OrcadManagedStopRequest
} from '../../shared/mantad-stop-request'
import { claimOrcadManagedStopDecision } from './mantad-managed-stop-decision'
import {
  orcadManagedStopRequestPath,
  readOrcadManagedStopRequest
} from './mantad-managed-stop-request'

/** `dispatched` means mantad already began stopping; only its completion can say how it ended. */
export function cancelOrcadManagedStop(
  request: OrcadManagedStopRequest
): OrcadManagedStopCancellation['outcome'] {
  const outcome = claimOrcadManagedStopDecision(request, 'canceled')
  if (outcome === 'canceled') {
    withdrawOrcadManagedStopRequest(request)
  }
  return outcome
}

/** Removes the request file only while it still carries this transaction. */
export function withdrawOrcadManagedStopRequest(request: OrcadManagedStopRequest): void {
  const path = orcadManagedStopRequestPath(request.instance)
  try {
    if (readOrcadManagedStopRequest(path).transactionId === request.transactionId) {
      rmSync(path, { force: true })
    }
  } catch {
    // Absent or another transaction's request: the standing decision already fences this one.
  }
}
