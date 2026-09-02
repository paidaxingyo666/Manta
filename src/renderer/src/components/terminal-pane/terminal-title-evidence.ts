import { normalizeCompatibleAgentTitleForOwner } from '../../../../shared/agent-title-owner'
import type { AgentType } from '../../../../shared/agent-status-types'
import {
  resolvePaneRendererPolicy,
  type RendererPolicyDecision,
  type TerminalGpuAccelerationMode
} from './terminal-renderer-policy'

/** Keeps the display label on the resolved owner instead of raw wrapper identity. */
export function resolvePaneDisplayTitle(
  title: string,
  ownerAgentType: AgentType | null | undefined,
  ownerIsLaunch = false
): string {
  return normalizeCompatibleAgentTitleForOwner(title, ownerAgentType, { ownerIsLaunch })
}

/** One owner-aware OSC title interpretation shared by display, tracking, and GPU policy. */
export type PaneTitleDecision = {
  displayTitle: string
  rawTitle: string
  rendererPolicy: RendererPolicyDecision
}

export type ResolvePaneTitleDecisionInput = {
  /** Normalized title from the transport (may already be display-shaped). */
  normalizedTitle: string
  rawTitle: string
  /** Display ownership may retain tab-scoped launch identity. */
  displayOwnerAgentType: AgentType | null | undefined
  /** True when displayOwnerAgentType is user-selected launch ownership. */
  displayOwnerIsLaunch?: boolean
  /** Renderer ownership stays pane-scoped so stale siblings cannot bypass the GPU veto. */
  rendererOwnerAgentType: AgentType | null | undefined
  userGpuMode: TerminalGpuAccelerationMode
  webglUnavailable?: boolean
  inContextLossContainment?: boolean
}

export function resolvePaneTitleDecision(input: ResolvePaneTitleDecisionInput): PaneTitleDecision {
  const displayTitle = resolvePaneDisplayTitle(
    input.normalizedTitle,
    input.displayOwnerAgentType,
    input.displayOwnerIsLaunch === true
  )
  const rendererPolicy = resolvePaneRendererPolicy({
    rawTitle: input.rawTitle,
    ownerAgentType: input.rendererOwnerAgentType,
    userGpuMode: input.userGpuMode,
    webglUnavailable: input.webglUnavailable,
    inContextLossContainment: input.inContextLossContainment
  })
  return { displayTitle, rawTitle: input.rawTitle, rendererPolicy }
}
