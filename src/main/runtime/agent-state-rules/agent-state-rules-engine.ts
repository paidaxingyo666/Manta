import type { TuiAgent } from '../../../shared/tui-agent'
import { compileScreenCondition, type ScreenMatcher } from './agent-state-rule-matchers'
import { BUNDLED_AGENT_STATE_RULE_FILES } from './agent-state-rules-catalog'
import type { AgentStateRuleAnswer, AgentStateRulesFile } from './agent-state-rules-schema'

/** What the first matching rule answered. Callers rank it among the other readiness lanes. */
export type AgentStateVerdict = { ruleId: string } & AgentStateRuleAnswer

/** The regions a rule may read, each null when no trustworthy copy exists. */
export type AgentStateRegions = {
  readScreenLines: () => readonly string[] | null
}

type CompiledRule = { verdict: AgentStateVerdict; matches: ScreenMatcher }

export function compileAgentRules(file: AgentStateRulesFile): CompiledRule[] {
  // Why stable: equal priorities keep file order.
  return file.rules
    .toSorted((left, right) => right.priority - left.priority)
    .map((rule) => ({
      verdict: { ruleId: rule.id, ...rule.answer },
      matches: compileScreenCondition(rule.when)
    }))
}

const RULES_BY_AGENT: ReadonlyMap<TuiAgent, CompiledRule[]> = new Map(
  BUNDLED_AGENT_STATE_RULE_FILES.filter((file) => file.rules.length > 0).map((file) => [
    file.id,
    compileAgentRules(file)
  ])
)

/**
 * Whether the agent's own rules read its screen. Why it changes which screen is read: those rules
 * were recorded against the PTY's trusted grid, while every other agent keeps the live screen.
 */
export function hasScreenRules(agent: TuiAgent | null | undefined): boolean {
  return agent ? RULES_BY_AGENT.has(agent) : false
}

export function evaluateCompiledRules(
  rules: readonly CompiledRule[],
  regions: AgentStateRegions
): AgentStateVerdict | null {
  // Why no answer rather than a refusal: with no trusted grid the caller's text lanes decide.
  const screenLines = rules.length > 0 ? regions.readScreenLines() : null
  if (screenLines === null) {
    return null
  }
  for (const rule of rules) {
    if (rule.matches(screenLines)) {
      return rule.verdict
    }
  }
  return null
}

/** The agent's priority list over its regions: the first match answers; none leaves it to the caller. */
export function evaluateAgentStateRules(
  agent: TuiAgent | null | undefined,
  regions: AgentStateRegions
): AgentStateVerdict | null {
  const rules = agent ? RULES_BY_AGENT.get(agent) : undefined
  return rules ? evaluateCompiledRules(rules, regions) : null
}
