import { randomUUID } from 'node:crypto'
import type { MantaRuntimeService } from '../runtime/manta-runtime'

export type RemoteWorkspaceClientNameSource = Pick<MantaRuntimeService, 'readMachineName'>

export const CLIENT_ID = randomUUID()

/** Read at send time from the runtime's name, so a rename reaches the next presence frame, not the next launch. */
export function readClientName(source: RemoteWorkspaceClientNameSource): string {
  return source.readMachineName() || 'This device'
}
