import type { OrcaSessionId } from '../../../shared/manta-session-address'
import { structuredWorkerOrcaSessionIdForIncarnation } from '../structured-worker-identity'
import { canonicalOrcaSessionId } from './canonical-manta-session-id'

/** The Manta session id a Dispatch row stores for the structured worker a process incarnation names. */
export function dispatchAssigneeOrcaSessionId(
  processIncarnation: string | null | undefined
): OrcaSessionId | null {
  const orcaSessionId = structuredWorkerOrcaSessionIdForIncarnation(processIncarnation)
  return orcaSessionId === null ? null : canonicalOrcaSessionId(orcaSessionId)
}
