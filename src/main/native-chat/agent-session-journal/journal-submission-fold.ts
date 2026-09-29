// Folding submission rows: the queue entry, its message row, where a handover places it, and the
// provider item an accepted message adopts.

import {
  AGENT_JOURNAL_THREAD_SCOPE,
  type AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../../shared/agent-session-journal-item-key'
import { journalRenderItem } from './journal-render-item'
import { statedOrDerivedTurnScope, upsertJournalItem } from './journal-item-fold'
import type { JournalReducerState } from './journal-reducer'
import type { JournalRow } from './journal-row-schema'

export function applyJournalSubmission(
  state: JournalReducerState,
  row: Extract<JournalRow, { kind: 'submission' }>
): void {
  state.submissions.set(row.clientMessageId, {
    clientMessageId: row.clientMessageId,
    fence: row.fence,
    payloadFingerprint: row.payloadFingerprint,
    dispatchState: 'pending',
    providerItemId: null,
    reason: null,
    submittedAt: row.ts,
    resolvedAt: null,
    ...(row.handoverRecorded ? { handoverRecorded: true, acceptedSequence: row.seq } : {})
  })
  const itemId = agentJournalSubmissionKey(row.clientMessageId)
  // A message handed over later belongs to no turn until its handover names one.
  const turnScope = row.handoverRecorded
    ? AGENT_JOURNAL_THREAD_SCOPE
    : statedOrDerivedTurnScope(state, row)
  upsertJournalItem(
    state,
    itemId,
    0,
    journalRenderItem(itemId, 0, row.body, row, turnScope),
    row.fence
  )
}

/** A queued message joins the conversation where it was handed over, not where it was accepted:
 *  what the agent did meanwhile — a command it waited behind, say — happened before it. It joins
 *  the turn that handover delivered it into — a steer — or none. Rows from hosts that predate the
 *  stated scope are scoped at the handover, as their creation would have been. */
export function placeHandedOverMessage(
  state: JournalReducerState,
  submission: AgentJournalSubmission,
  row: Extract<JournalRow, { kind: 'dispatch' }>
): void {
  const itemId = agentJournalSubmissionKey(submission.clientMessageId)
  const item = state.items.get(itemId)
  if (!submission.handoverRecorded || !item) {
    return
  }
  const { sequenceIndex: _acceptedAt, ...accepted } = item
  state.items.set(itemId, {
    ...accepted,
    sequence: row.seq,
    observedAt: row.ts,
    turnScope: row.turnScope ?? state.derivedTurnScope.scopeFor(item.body)
  })
}

export function acceptSubmissionFromProviderItem(
  state: JournalReducerState,
  providerItemId: string,
  resolvedItemId: string,
  row: Pick<JournalRow, 'epoch' | 'seq' | 'fence' | 'ts'>
): void {
  if (providerItemId === resolvedItemId) {
    return
  }
  const submission = [...state.submissions.values()].find(
    (candidate) => agentJournalSubmissionKey(candidate.clientMessageId) === resolvedItemId
  )
  if (
    !submission ||
    submission.dispatchState === 'accepted' ||
    submission.dispatchState === 'rejected'
  ) {
    return
  }
  submission.fence = row.fence
  submission.dispatchState = 'accepted'
  submission.providerItemId = providerItemId
  submission.reason = null
  submission.resolvedAt = row.ts
  delete submission.recovered
  state.receipts.set(submission.clientMessageId, {
    clientMessageId: submission.clientMessageId,
    providerItemId,
    cursor: { epoch: row.epoch, sequence: row.seq },
    acceptedAt: row.ts
  })
}
