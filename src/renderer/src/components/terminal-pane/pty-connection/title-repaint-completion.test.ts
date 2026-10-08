import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import {
  isTitleCompletionRepaint,
  recordSettledAgentCompletion,
  resetSettledAgentCompletionsForTest
} from './title-repaint-completion'

const PANE = 'tab:leaf'
const SETTLED = 2_000_000

function row(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'done',
    prompt: 'p',
    updatedAt: 1_500_000,
    stateStartedAt: 1_500_000,
    agentType: 'codex',
    paneKey: PANE,
    stateHistory: [],
    ...overrides
  }
}

function check(
  currentRow: AgentStatusEntry | undefined,
  overrides: { foregroundAgent?: string | null; lastUserInputAt?: number } = {}
): boolean {
  return isTitleCompletionRepaint({
    paneKey: PANE,
    currentRow,
    foregroundAgent: overrides.foregroundAgent === undefined ? 'codex' : overrides.foregroundAgent,
    lastUserInputAt: overrides.lastUserInputAt
  })
}

beforeEach(() => {
  resetSettledAgentCompletionsForTest()
})

describe('isTitleCompletionRepaint', () => {
  it('is a repaint when the row has not moved since the pane settled and nobody typed', () => {
    recordSettledAgentCompletion(PANE, row(), SETTLED)
    expect(check(row())).toBe(true)
    expect(check(row(), { lastUserInputAt: SETTLED - 1 })).toBe(true)
  })

  it('ignores a relay restamp of updatedAt', () => {
    recordSettledAgentCompletion(PANE, row(), SETTLED)
    expect(check(row({ updatedAt: 9_999_999 }))).toBe(true)
  })

  it('announces once the row moved, the user typed, or another agent is in front', () => {
    recordSettledAgentCompletion(PANE, row(), SETTLED)
    expect(check(row({ state: 'working', stateStartedAt: 2_100_000 }))).toBe(false)
    expect(check(row({ stateStartedAt: 2_100_000 }))).toBe(false)
    expect(check(row(), { lastUserInputAt: SETTLED + 1 })).toBe(false)
    expect(check(row(), { foregroundAgent: 'aider' })).toBe(false)
    expect(check(row(), { foregroundAgent: null })).toBe(false)
  })

  it('announces agents without a row or with an unknown agent', () => {
    expect(check(undefined)).toBe(false)
    recordSettledAgentCompletion(PANE, row({ agentType: 'unknown' }), SETTLED)
    expect(check(row({ agentType: 'unknown' }))).toBe(false)
  })

  it('announces while nothing settled the pane', () => {
    expect(check(row())).toBe(false)
  })

  it('does not settle a turn without a start time', () => {
    recordSettledAgentCompletion(PANE, { state: 'done', agentType: 'codex' }, SETTLED)
    expect(check(row())).toBe(false)
  })
})
