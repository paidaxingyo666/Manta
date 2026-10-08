import type { AgentStatusEntry, AgentType } from '../../../../../shared/agent-status-types'
import { shareCompatibleTitleIdentityGroup } from '../../../../../shared/agent-title-owner'

type SettledCompletion = { marker: string; settledAt: number }

const SETTLED_PANES_MAX = 512
const settledByPaneKey = new Map<string, SettledCompletion>()

type TurnFacts = Pick<AgentStatusEntry, 'state' | 'agentType'> & { stateStartedAt?: number }

/** A new turn moves `state`/`stateStartedAt`; `updatedAt` is left out because relay replays restamp it. */
function agentStatusTurnMarker(turn: TurnFacts | undefined): string | null {
  if (!turn || typeof turn.stateStartedAt !== 'number') {
    return null
  }
  return [turn.state, turn.stateStartedAt, turn.agentType ?? ''].join('|')
}

/** Called when a completion for the pane was actually announced, with the turn it announced. */
export function recordSettledAgentCompletion(
  paneKey: string,
  turn: TurnFacts | undefined,
  now = Date.now()
): void {
  const marker = agentStatusTurnMarker(turn)
  if (marker === null) {
    return
  }
  settledByPaneKey.delete(paneKey)
  settledByPaneKey.set(paneKey, { marker, settledAt: now })
  if (settledByPaneKey.size > SETTLED_PANES_MAX) {
    const oldest = settledByPaneKey.keys().next().value
    if (oldest !== undefined) {
      settledByPaneKey.delete(oldest)
    }
  }
}

/**
 * A title working→idle the pane's own agent painted with no turn behind it: its status row has
 * not moved since the pane last settled and nobody typed since. Codex re-attaching to a restarted
 * app-server spins its title and settles again this way. Agents with no row, runs the user
 * started, and a different agent in front still announce.
 */
export function isTitleCompletionRepaint(args: {
  paneKey: string
  currentRow: AgentStatusEntry | undefined
  foregroundAgent: AgentType | null
  lastUserInputAt: number | undefined
}): boolean {
  const { currentRow, foregroundAgent, lastUserInputAt } = args
  const marker = agentStatusTurnMarker(currentRow)
  const settled = settledByPaneKey.get(args.paneKey)
  if (!settled || marker !== settled.marker) {
    return false
  }
  const rowAgent = currentRow?.agentType
  if (
    !rowAgent ||
    rowAgent === 'unknown' ||
    !shareCompatibleTitleIdentityGroup(rowAgent, foregroundAgent)
  ) {
    return false
  }
  return lastUserInputAt === undefined || lastUserInputAt < settled.settledAt
}

export function resetSettledAgentCompletionsForTest(): void {
  settledByPaneKey.clear()
}
