import { describe, expect, it } from 'vitest'
import { agentSessionFailureFact } from './agent-session-failure'
import { agentSessionFailureWords } from './agent-session-failure-words'
import { agentJournalItemKey, agentJournalSubmissionKey } from './agent-session-journal-item-key'
import {
  structuredAgentSessionSendOpeningTurn,
  type StructuredAgentSessionOpeningSendItem
} from './structured-agent-session-opening-send'
import { structuredAgentSessionStopNoteIdentity } from './structured-agent-session-stop-note-key'

const send = {
  clientMessageId: 'send-1',
  dispatchState: 'pending',
  handedOverAt: 10,
  fence: 1
} as const
const handover: StructuredAgentSessionOpeningSendItem = {
  itemId: agentJournalSubmissionKey('send-1'),
  sequence: 5,
  body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'first' }] },
  turnScope: { kind: 'thread' }
}
const turnRecord = (sequence: number): StructuredAgentSessionOpeningSendItem => ({
  itemId: `turn-${sequence}`,
  sequence,
  body: { kind: 'turn', turnId: 'turn-1', state: 'running' }
})
const stopNote = (sequence: number): StructuredAgentSessionOpeningSendItem => ({
  itemId: agentJournalItemKey(structuredAgentSessionStopNoteIdentity(`op-${sequence}`)),
  sequence,
  body: { kind: 'status', text: 'Cancellation requested.' },
  turnScope: { kind: 'thread' }
})

function opening(items: StructuredAgentSessionOpeningSendItem[]): boolean {
  return structuredAgentSessionSendOpeningTurn([send], (visit) => items.forEach(visit), 1)
}

describe('a send still opening its turn', () => {
  it('holds the next message until a turn record follows its handover', () => {
    expect(opening([handover])).toBe(true)
    expect(opening([handover, turnRecord(6)])).toBe(false)
  })

  // A Stop the provider took before the turn opened may write no turn record at all.
  it("ends at a taken Stop's note written after the handover, so a later message is not held", () => {
    expect(opening([handover, stopNote(6)])).toBe(false)
  })

  // A refused or unconfirmed Stop leaves the turn opening: the next message still joins it.
  it("keeps holding past a Stop's note that carries a failure", () => {
    const refused = stopNote(6)
    expect(
      opening([
        handover,
        {
          ...refused,
          body: {
            kind: 'status',
            ...agentSessionFailureWords(agentSessionFailureFact('cancelUnconfirmed'), {
              surface: 'row'
            })
          }
        }
      ])
    ).toBe(true)
  })

  it("keeps holding past a Stop's note written before the handover", () => {
    expect(opening([stopNote(4), handover])).toBe(true)
  })
})
