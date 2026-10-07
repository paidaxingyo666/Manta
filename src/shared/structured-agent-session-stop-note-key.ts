// A Stop's note row is keyed so the host and every client can tell it from other Manta rows.

import { parseAgentJournalItemKey } from './agent-session-journal-item-key'
import type { AgentJournalItemIdentity } from './agent-session-journal-types'

const STOP_NOTE_PREFIX = 'stop:'

/** A Stop's note, keyed by the turn it stopped (or, with no turn, by its operation). */
export function structuredAgentSessionStopNoteIdentity(stopKey: string): AgentJournalItemIdentity {
  return { provider: 'manta', clientMessageId: `${STOP_NOTE_PREFIX}${stopKey}` }
}

/** Whether a journal row is a Stop's note. */
export function isStructuredAgentSessionStopNote(itemId: string): boolean {
  const identity = parseAgentJournalItemKey(itemId)
  return identity?.provider === 'manta' && identity.clientMessageId.startsWith(STOP_NOTE_PREFIX)
}
