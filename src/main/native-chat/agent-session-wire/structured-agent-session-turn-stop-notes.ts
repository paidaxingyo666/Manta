// A Stop's note sits on the turn it stopped, found by the turn's id whether it still runs or has
// ended, and keyed by that turn, so a repeated Stop rewrites the one row instead of adding one.

import type { AgentJournalTurnScope } from '../../../shared/agent-session-journal-types'
import { readAgentJournalTurn } from '../../../shared/agent-session-turn-record'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'

export const STOP_NOTE_CANCELLATION_REQUESTED = 'Cancellation requested.'

/** The scope of the turn `turnId` names, running or ended; null when the journal has no such turn. */
export function structuredAgentSessionNamedTurnScope(
  journal: Pick<AgentSessionJournal, 'snapshot'>,
  turnId: string
): Extract<AgentJournalTurnScope, { kind: 'turn' }> | null {
  const turn = journal
    .snapshot()
    .items.findLast((item) => readAgentJournalTurn(item.body)?.turnId === turnId)
  return turn ? { kind: 'turn', turnItemId: turn.itemId } : null
}
