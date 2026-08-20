import type { TuiAgent } from '../../../src/shared/tui-agent'
import { MOBILE_AGENT_CATALOG } from '../tasks/mobile-agent-catalog'
import { isMobileTuiAgentEnabled } from '../tasks/mobile-tui-agents'
import { pickWorkspaceAgent } from '../tasks/workspace-agent-selection'
import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'

export type NewWorktreeRuntimeSettings = {
  defaultTuiAgent?: TuiAgent | 'blank' | null
  disabledTuiAgents?: TuiAgent[]
}

export type NewWorktreeAgentOption = {
  id: TuiAgent | '__blank__'
  label: string
  faviconDomain?: string
}

export const NEW_WORKTREE_AGENT_OPTIONS: NewWorktreeAgentOption[] = MOBILE_AGENT_CATALOG

export const newWorktreeBlankAgent = localizedConstant(
  (): NewWorktreeAgentOption => ({
    id: '__blank__',
    label: translate('m.new.worktree.agent.selection.f38095bad3', 'Blank Terminal')
  })
)

export function newWorktreeAgentOptionFor(id: string | null | undefined): NewWorktreeAgentOption {
  if (id === 'blank' || id === '__blank__') {
    return newWorktreeBlankAgent()
  }
  return NEW_WORKTREE_AGENT_OPTIONS.find((agent) => agent.id === id) ?? newWorktreeBlankAgent()
}

export function pickPreferredNewWorktreeAgent(
  settings: NewWorktreeRuntimeSettings | null,
  detectedAgentIds: Set<string> | null
): NewWorktreeAgentOption {
  return newWorktreeAgentOptionFor(
    pickWorkspaceAgent(
      {
        defaultTuiAgent: settings?.defaultTuiAgent,
        disabledTuiAgents: settings?.disabledTuiAgents
      },
      detectedAgentIds
    )
  )
}

function isSelectableAgent(
  agent: NewWorktreeAgentOption,
  settings: NewWorktreeRuntimeSettings | null,
  detectedAgentIds: Set<string> | null
): boolean {
  if (agent.id === '__blank__') {
    return true
  }
  if (!isMobileTuiAgentEnabled(agent.id, settings?.disabledTuiAgents)) {
    return false
  }
  return detectedAgentIds === null || detectedAgentIds.has(agent.id)
}

export function resolveNewWorktreeAgentSelection({
  visible,
  selectedAgent,
  agentOverridden,
  runtimeSettings,
  detectedAgentIds
}: {
  visible: boolean
  selectedAgent: NewWorktreeAgentOption
  agentOverridden: boolean
  runtimeSettings: NewWorktreeRuntimeSettings | null
  detectedAgentIds: Set<string> | null
}): { selectedAgent: NewWorktreeAgentOption; agentOverridden: boolean } {
  if (!visible) {
    return { selectedAgent, agentOverridden }
  }

  const preferred = pickPreferredNewWorktreeAgent(runtimeSettings, detectedAgentIds)
  if (!agentOverridden) {
    return { selectedAgent: preferred, agentOverridden: false }
  }

  if (
    detectedAgentIds !== null &&
    !isSelectableAgent(selectedAgent, runtimeSettings, detectedAgentIds)
  ) {
    return { selectedAgent: preferred, agentOverridden: false }
  }

  return { selectedAgent, agentOverridden: true }
}
