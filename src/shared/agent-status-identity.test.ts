/**
 * The fence that stops a nested agent CLI from taking over a pane's identity.
 *
 * Child agents inherit MANTA_PANE_KEY from the terminal that launched them, so a
 * subagent's hook posts under its parent's pane key. Three call sites share this
 * decision — the hook server and two renderer reducers — and it had no unit test
 * of its own, which is how four separate attempts to extend it were built on
 * assumptions about what it returns.
 */
import { describe, expect, it } from 'vitest'
import {
  resolveAgentStatusIdentity,
  shouldSuppressInheritedTerminalStatus
} from './agent-status-identity'

const NOW = 1_000_000
const FRESH = { state: 'working' as const, updatedAt: NOW - 1_000 }

describe('resolveAgentStatusIdentity', () => {
  it('keeps the pane on its own agent while that agent is mid-turn', () => {
    expect(
      resolveAgentStatusIdentity({
        existing: { agentType: 'claude', ...FRESH },
        incoming: 'codex',
        now: NOW
      })
    ).toEqual({ agentType: 'claude', inheritedFromActivePane: true })
  })

  /**
   * The gap the reported hijack went through: a review subagent is spawned once
   * the parent turn ENDS, so the incumbent row is `done` and the fence yields.
   * Pinned as-is — this documents the hole rather than asserting it is right.
   */
  it('yields the pane once the incumbent turn is done', () => {
    expect(
      resolveAgentStatusIdentity({
        existing: { agentType: 'claude', state: 'done', updatedAt: NOW - 1_000 },
        incoming: 'codex',
        now: NOW
      })
    ).toEqual({ agentType: 'codex', inheritedFromActivePane: false })
  })

  it('yields once the incumbent has gone stale', () => {
    expect(
      resolveAgentStatusIdentity({
        existing: { agentType: 'claude', state: 'working', updatedAt: NOW - 60_000 },
        incoming: 'codex',
        now: NOW,
        staleAfterMs: 30_000
      })
    ).toEqual({ agentType: 'codex', inheritedFromActivePane: false })
  })

  // Same agent reporting again is the ordinary case and must never be fenced.
  it('never fences an agent against itself', () => {
    expect(
      resolveAgentStatusIdentity({
        existing: { agentType: 'claude', ...FRESH },
        incoming: 'claude',
        now: NOW
      })
    ).toEqual({ agentType: 'claude', inheritedFromActivePane: false })
  })

  it('adopts the incoming agent when the pane has none', () => {
    expect(resolveAgentStatusIdentity({ incoming: 'codex', now: NOW })).toEqual({
      agentType: 'codex',
      inheritedFromActivePane: false
    })
  })

  /**
   * An absent or `unknown` incoming type also fails the agentType comparison
   * downstream, but the fence did NOT fire — anything keyed off that comparison
   * instead of off inheritedFromActivePane misreads this case.
   */
  it('falls back to the incumbent without calling it a fence', () => {
    expect(
      resolveAgentStatusIdentity({
        existing: { agentType: 'claude', ...FRESH },
        incoming: undefined,
        now: NOW
      })
    ).toEqual({ agentType: 'claude', inheritedFromActivePane: false })
    expect(
      resolveAgentStatusIdentity({
        existing: { agentType: 'claude', ...FRESH },
        incoming: 'unknown',
        now: NOW
      })
    ).toEqual({ agentType: 'claude', inheritedFromActivePane: false })
  })

  it('reports unknown when neither side names an agent', () => {
    expect(resolveAgentStatusIdentity({ now: NOW }).agentType).toBe('unknown')
  })
})

describe('shouldSuppressInheritedTerminalStatus', () => {
  it('drops a fenced child’s completion so it cannot end the pane’s turn', () => {
    expect(
      shouldSuppressInheritedTerminalStatus({
        inheritedFromActivePane: true,
        incomingState: 'done'
      })
    ).toBe(true)
  })

  it('lets the pane’s own completion through', () => {
    expect(
      shouldSuppressInheritedTerminalStatus({
        inheritedFromActivePane: false,
        incomingState: 'done'
      })
    ).toBe(false)
  })
})
