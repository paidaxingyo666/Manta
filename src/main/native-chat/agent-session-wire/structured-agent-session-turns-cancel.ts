import { agentChildWorkStopTargets } from '../../../shared/agent-child-work-stop-targets'
import { agentSessionFailureFact } from '../../../shared/agent-session-failure'
import type { AgentChildWorkView } from '../../../shared/agent-status-child-work-view'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import type { AgentJournalStatusItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionCancelResult } from '../../../shared/agent-session-wire'
import { latestJournalDispatchObservation } from '../agent-session-journal/journal-dispatch-observation'
import type { AgentSessionCancelOutcome } from './structured-agent-session-adapter'
import {
  isStructuredAgentSessionCommandTurnId,
  structuredAgentSessionCommandWasStopped,
  structuredAgentSessionStopNoteIdentity
} from './structured-agent-session-command-turn'
import {
  answerCancelOfSettledPrompt,
  validatePendingPrompt
} from './structured-agent-session-prompt-state'
import {
  STOP_NOTE_CANCELLATION_REQUESTED,
  structuredAgentSessionNamedTurnScope
} from './structured-agent-session-turn-stop-notes'
import { isStructuredAgentSessionMainAgentWorking } from '../../../shared/structured-agent-session-main-agent-working'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'

/** Claude's echo accepts a send one sink write before its turn row lands, so read after the drain.
 *  A failed drain reads working: bookkeeping never talks a Stop out of stopping. */
export async function isMainAgentWorkingOnceFlushed(
  ctx: Pick<AgentSessionTurnContext, 'journal' | 'fence' | 'flushStreamedEvents'>
): Promise<boolean> {
  try {
    await ctx.flushStreamedEvents()
  } catch {
    return true
  }
  return isStructuredAgentSessionMainAgentWorking(
    ctx.journal.activeTurnId(),
    ctx.journal.submissions(),
    ctx.fence
  )
}

/** What a Stop that ends the provider's session leaves its next serialized step: whether the
 *  provider took the interrupt, so its wind-down is worth waiting on, and when the interrupt went
 *  out. No turn id: that step runs right behind the Stop, so no later turn can slip in between. */
export type StructuredAgentSessionStopWindDown = { waitsForProvider: boolean; stoppedAt: number }

/**
 * A session-ending Stop's second step, queued behind its first in the same tick so nothing sent
 * meanwhile reaches the child it ends. The Stop has answered: a failure here is reported. The next
 * Stop retries the wind-down it leaves owed, and so does the idle sweep: at its next tick once the
 * child is proven gone, else only after the chat idles with no child work left.
 */
export async function endStoppedStructuredAgentSession(
  ctx: Pick<AgentSessionTurnContext, 'sessionId' | 'adapter'>,
  windDown: StructuredAgentSessionStopWindDown,
  stopChild: () => Promise<void>,
  onError: (error: unknown) => void
): Promise<void> {
  try {
    if (windDown.waitsForProvider) {
      await ctx.adapter.awaitStoppedRequestEnd?.(ctx.sessionId, windDown.stoppedAt)
    }
    await stopChild()
  } catch (error) {
    onError(error)
  }
}

export async function performCancel(
  ctx: AgentSessionTurnContext,
  input: {
    clientOperationId: string
    /** Absent: whatever the conversation has in flight; present: only while that turn is current. */
    turnId?: string
    scope?: 'background-tasks'
    taskId?: string
    prompt?: { itemId: string; expectedRevision: number }
    /** Ends the provider child, for a running command the provider did not take the Stop on. */
    stopChild?: () => Promise<void>
    /** Hands the child's end to the Stop's next serialized step, for a provider whose Stop ends
     *  its session. */
    endSession?: (windDown: StructuredAgentSessionStopWindDown) => void
    /** The host already withdrew queued messages for this Stop. */
    withdrewQueued?: boolean
    /** The session's child records: a background Stop reaches the tasks they offer a stop. */
    childWork?: () => readonly AgentChildWorkView[] | undefined
  }
): Promise<TurnOutcome<AgentSessionCancelResult>> {
  if (input.prompt) {
    const validated = validatePendingPrompt(ctx, input.prompt)
    if (!validated.ok) {
      return answerCancelOfSettledPrompt(ctx, { ...input, prompt: input.prompt }, validated)
    }
  }
  let cancelled = false
  let note: AgentJournalStatusItem | null = {
    kind: 'status',
    text: STOP_NOTE_CANCELLATION_REQUESTED
  }
  // The turn the Stop names, read before the cancel settles it: the note reports on that turn.
  const turnScope =
    (input.turnId !== undefined && !input.scope
      ? structuredAgentSessionNamedTurnScope(ctx.journal, input.turnId)
      : null) ?? ctx.journal.liveTurnScope()
  // Only the provider's end or the child's ends a command. A command the provider has not opened a
  // turn for, would not interrupt, or was already asked to stop, ends with its child; that child's
  // dead-generation settlement writes the command's verdict.
  const liveTurnId = ctx.journal.activeTurnId()
  const runningCommand =
    input.stopChild !== undefined &&
    liveTurnId !== null &&
    isStructuredAgentSessionCommandTurnId(liveTurnId) &&
    (input.turnId === undefined || input.turnId === liveTurnId)
  const stoppedBefore =
    runningCommand && structuredAgentSessionCommandWasStopped(ctx.journal, liveTurnId)
  // Read while the child is live: a provider whose Stop is a session boundary loses it next.
  const endsSession =
    input.endSession !== undefined && ctx.adapter.stopEndsSession?.(ctx.sessionId) === true
  const stoppedAt = Date.now()
  // The provider's own answer; unset when its cancel threw, leaving the effect unknown.
  let taken: boolean | undefined
  try {
    const dispatchStatus = latestJournalDispatchObservation(ctx.journal, ctx.fence)
    const outcome: AgentSessionCancelOutcome = stoppedBefore
      ? { cancelled: false }
      : input.scope
        ? {
            cancelled:
              (
                await ctx.adapter.stopBackgroundTasks?.({
                  sessionId: ctx.sessionId,
                  fence: ctx.fence,
                  taskIds: agentChildWorkStopTargets(input.childWork?.(), input.taskId)
                })
              )?.cancelled === true
          }
        : await ctx.adapter.cancelTurn({
            sessionId: ctx.sessionId,
            ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
            fence: ctx.fence,
            // The journal is what the client read to name a turn, so it is what judges the request.
            resolveLiveTurnId: () => ctx.journal.activeTurnId(),
            ...(dispatchStatus ? { dispatchStatus } : {}),
            ...(input.prompt ? { prompt: { itemId: input.prompt.itemId } } : {})
          })
    taken = outcome.cancelled
    cancelled = outcome.cancelled
    if (!cancelled && input.withdrewQueued && !(await isMainAgentWorkingOnceFlushed(ctx))) {
      // A Stop that withdrew what was queued and left nothing working ended what it was sent for,
      // named or not. The journal judges it: providers differ on refusing a turn that has ended.
      cancelled = true
      note = null
    } else if (!cancelled && input.prompt) {
      note = null
    } else if (!cancelled && input.turnId === undefined) {
      // Sent only while the chat reads working, so a Stop that ended nothing must say why.
      const detail = outcome.refusal?.detail
      note = {
        kind: 'status',
        ...agentSessionFailureWords(
          agentSessionFailureFact('stopRefused', detail ? { detail } : {}),
          { ...ctx.failureTextContext, surface: 'row' }
        )
      }
    }
  } catch (error) {
    if (input.prompt) {
      throw error
    }
    // The adapter's error is Manta's; the row says only that the stop is unconfirmed.
    note = {
      kind: 'status',
      ...agentSessionFailureWords(agentSessionFailureFact('cancelUnconfirmed'), { surface: 'row' })
    }
  }
  // A Stop naming a turn that has since ended keeps the session only when the provider declined
  // it: an interrupt, answered or not, can stop a follow-up whose turn has not opened.
  if (
    endsSession &&
    (input.turnId === undefined || input.turnId === liveTurnId || taken !== false)
  ) {
    // An interrupt the provider took is worth waiting on, turn row or not: a Stop before the echo
    // has none, and the echo still opens the turn the Stop interrupted.
    input.endSession?.({ waitsForProvider: taken === true, stoppedAt })
    cancelled = true
    // The child's end confirms the Stop, so a refused or unconfirmed interrupt says nothing more.
    if (note !== null) {
      note = { kind: 'status', text: 'Cancellation requested.' }
    }
  } else if (runningCommand && !cancelled) {
    await input.stopChild?.()
    cancelled = true
    note = { kind: 'status', text: STOP_NOTE_CANCELLATION_REQUESTED }
  }
  if (!cancelled && taken === false && input.turnId !== undefined) {
    // Nothing was left of the turn it named and nothing else ended: a Stop that ends nothing writes no row.
    note = null
  }
  if (cancelled && input.prompt) {
    await ctx.flushStreamedEvents()
  }
  const value = { ...(input.turnId !== undefined ? { turnId: input.turnId } : {}), cancelled }
  if (input.scope || note === null) {
    return { ok: true, value }
  }
  // Keyed by the turn it stopped, so another Stop of that turn rewrites this row, never adds one.
  await ctx.journal.appendItem(
    structuredAgentSessionStopNoteIdentity(input.turnId ?? liveTurnId ?? input.clientOperationId),
    note,
    { fence: ctx.fence, turnScope }
  )
  return { ok: true, value }
}
