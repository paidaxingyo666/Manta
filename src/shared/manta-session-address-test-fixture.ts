import { isOrcaSessionId, type OrcaSessionId } from './manta-session-address'

/** A literal Manta session id for a test, checked by the same predicate production uses. */
export function testOrcaSessionId(id: string): OrcaSessionId {
  if (!isOrcaSessionId(id)) {
    throw new Error(`Not a Manta session id: ${id}`)
  }
  return id
}
