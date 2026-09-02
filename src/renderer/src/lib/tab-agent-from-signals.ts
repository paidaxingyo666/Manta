import { isShellProcess } from '../../../shared/agent-detection'
import {
  isClaudeIdentityFrameTitle,
  resolveExplicitTerminalTitleAgentType
} from '../../../shared/terminal-title-agent-type'
import {
  resolveCompatibleAgentTypeForOwner,
  shareCompatibleTitleIdentityGroup
} from '../../../shared/agent-title-owner'
import { isOpenCodeNativeTitle } from '../../../shared/opencode-terminal-title'
import { resolvePaneAgentOwnerRecord } from '../../../shared/pane-agent-owner'
import type { TuiAgent } from '../../../shared/tui-agent'

// Shell/default titles prove no agent; blank titles prove nothing.
function titleShowsNoAgent(title: string, defaultTitle?: string): boolean {
  const trimmed = title.trim()
  return trimmed.length > 0 && (isShellProcess(trimmed) || trimmed === defaultTitle?.trim())
}

/** Resolves wrapper-compatible signal identity against the pane owner. */
function resolveSignalAgentForLaunchOwner(
  signalAgent: TuiAgent | null | undefined,
  ownerAgent: TuiAgent | null,
  ownerIsLaunch = false
): TuiAgent | null {
  if (!signalAgent) {
    return null
  }
  return (resolveCompatibleAgentTypeForOwner(signalAgent, ownerAgent, { ownerIsLaunch }) ??
    signalAgent) as TuiAgent
}

/** Detects local-only launch exit evidence without treating remote signal loss as exit. */
export function resolveLaunchedAgentExitEvidence(args: {
  title: string
  defaultTitle?: string
  isRemote: boolean
  hasObservedAgentSignal: boolean
  hookAgent: TuiAgent | null
  siblingHookAgent?: TuiAgent | null
  hasCompletedHook: boolean
  processAgent?: TuiAgent | null
  processShellForeground?: boolean
}): boolean {
  if (args.hookAgent || args.siblingHookAgent || args.processAgent) {
    return false
  }
  // OSC 133;D is local exit evidence; remote panes have no shell-foreground producer.
  if (!args.isRemote && args.processShellForeground && args.hasObservedAgentSignal) {
    return true
  }
  if (!titleShowsNoAgent(args.title, args.defaultTitle)) {
    return false
  }
  return args.hasCompletedHook || (!args.isRemote && args.hasObservedAgentSignal)
}

/** Identity precedence: live hook > process > title > completed > sleeping > launch > sibling. */
export function resolveTabAgentFromSignals(args: {
  hasObservedAgentSignal: boolean
  isRemote: boolean
  title: string
  defaultTitle?: string
  hookAgent: TuiAgent | null
  siblingHookAgent?: TuiAgent | null
  focusedCompletedHookAgent?: TuiAgent | null
  siblingCompletedHookAgent?: TuiAgent | null
  processAgent?: TuiAgent | null
  processShellForeground?: boolean
  sleepingSessionAgent?: TuiAgent | null
  launchAgent?: TuiAgent
}): TuiAgent | null {
  const launchAgent = args.launchAgent ?? null
  // Keep durable ownership focused-pane scoped so siblings cannot re-own its title.
  const ownerRecord = resolvePaneAgentOwnerRecord({
    launchAgent,
    hookAgent: args.hookAgent,
    completedHookAgent: args.focusedCompletedHookAgent,
    sleepingSessionAgent: args.sleepingSessionAgent
  })
  const owner = (ownerRecord?.agent ?? null) as TuiAgent | null
  const ownerIsLaunch = ownerRecord?.ownerIsLaunch === true

  // Sibling identities normalize only against launch intent.
  const liveFocusedIdentity = resolveSignalAgentForLaunchOwner(args.hookAgent, owner, ownerIsLaunch)
  const liveSiblingIdentity = resolveSignalAgentForLaunchOwner(
    args.siblingHookAgent,
    launchAgent,
    Boolean(launchAgent)
  )
  // OSC 133;D invalidates local idle identity; remote titles may merely lag.
  const processProvesShell = !args.isRemote && args.processShellForeground === true
  const hasCompletedHook = (args.focusedCompletedHookAgent ?? null) !== null
  const noAgentTitle = titleShowsNoAgent(args.title, args.defaultTitle)
  const idleIdentitySuppressed =
    !args.isRemote && (noAgentTitle || processProvesShell) && hasCompletedHook
  const idleFocusedIdentity = idleIdentitySuppressed
    ? null
    : resolveSignalAgentForLaunchOwner(args.focusedCompletedHookAgent, owner, ownerIsLaunch)
  // Focused-pane exit evidence must not clear sibling idle identity.
  const idleSiblingIdentity = resolveSignalAgentForLaunchOwner(
    args.siblingCompletedHookAgent,
    launchAgent,
    Boolean(launchAgent)
  )
  const sleepingSessionAgent = args.sleepingSessionAgent ?? null

  // Titles override only for different-group reuse or standalone legacy identity.
  const rawTitleAgent = resolveExplicitTerminalTitleAgentType(args.title)
  const explicitTitleAgent = resolveSignalAgentForLaunchOwner(rawTitleAgent, owner, ownerIsLaunch)
  const priorIdentity = idleFocusedIdentity ?? launchAgent
  const nativeOpenCodeTitle = explicitTitleAgent === 'opencode' && isOpenCodeNativeTitle(args.title)
  // A Claude mention is not identity; only presentation frames may reclaim a pane (#8940).
  const titleClaimsIdentity =
    explicitTitleAgent !== 'claude' || isClaudeIdentityFrameTitle(args.title)
  // Native OpenCode may reclaim stale launch intent; raw groups keep Pi/OMP wrappers compatible.
  const titleReclaimsReusedPane =
    priorIdentity !== null &&
    explicitTitleAgent !== null &&
    explicitTitleAgent !== priorIdentity &&
    !shareCompatibleTitleIdentityGroup(rawTitleAgent, priorIdentity) &&
    titleClaimsIdentity &&
    (args.hasObservedAgentSignal || hasCompletedHook || nativeOpenCodeTitle)
  // Native OpenCode titles lack a generation and cannot displace durable ownership.
  const titleAgent =
    processProvesShell ||
    sleepingSessionAgent ||
    (nativeOpenCodeTitle && idleFocusedIdentity !== null)
      ? null
      : titleReclaimsReusedPane
        ? explicitTitleAgent
        : priorIdentity
          ? null
          : explicitTitleAgent

  const launchedAgentExited = resolveLaunchedAgentExitEvidence({
    title: args.title,
    defaultTitle: args.defaultTitle,
    isRemote: args.isRemote,
    hasObservedAgentSignal: args.hasObservedAgentSignal,
    hookAgent: liveFocusedIdentity,
    siblingHookAgent: liveSiblingIdentity,
    hasCompletedHook,
    processAgent: args.processAgent,
    processShellForeground: args.processShellForeground
  })
  const activeLaunchAgent = launchedAgentExited ? null : launchAgent
  // Re-own nested Pi foreground reads so OMP tabs do not flip identity.
  const processAgent = resolveSignalAgentForLaunchOwner(args.processAgent, owner, ownerIsLaunch)
  return (
    liveFocusedIdentity ??
    processAgent ??
    titleAgent ??
    idleFocusedIdentity ??
    sleepingSessionAgent ??
    activeLaunchAgent ??
    liveSiblingIdentity ??
    idleSiblingIdentity
  )
}
