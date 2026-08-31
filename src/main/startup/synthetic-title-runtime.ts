import { registerPaneKeyTeardownListener, getPtyIdForPaneKey } from '../ipc/pty'
import { agentHookServer } from '../agent-hooks/server'
import type { AgentStatusState } from '../../shared/agent-status-types'
import {
  getSyntheticAgentTitleProfile,
  shouldDriveSyntheticAgentTitleFromHook,
  type SyntheticAgentTitleProfile
} from '../../shared/synthetic-agent-title'
import {
  advanceSyntheticTitleSpinnerEntries,
  getSyntheticTitleSpinnerPaneKeyToStop,
  type SyntheticTitleSpinnerEntry
} from '../synthetic-title-spinner'
import { shouldSendSyntheticTitleFrame } from '../synthetic-title-visibility'
import { shouldCopySyntheticTitleFrameToPtyData } from '../synthetic-title-frame-routing'
import { resolveTuiAgentPermissionMode } from '../../shared/tui-agent-permissions'
import { mainProcessState as state } from './main-process-state'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80
const syntheticTitleSpinnerByPaneKey = new Map<
  string,
  SyntheticTitleSpinnerEntry<SyntheticAgentTitleProfile>
>()
let syntheticTitleSpinnerTimer: ReturnType<typeof setInterval> | null = null

function isSyntheticTitleWindowVisible(): boolean {
  const window = state.mainWindow
  return window !== null && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
}

function sendSyntheticTitle(ptyId: string, data: string, options: { force?: boolean } = {}): void {
  const window = state.mainWindow
  if (!window || window.isDestroyed()) {
    return
  }
  if (
    !shouldSendSyntheticTitleFrame({
      force: options.force === true,
      windowVisible: isSyntheticTitleWindowVisible()
    })
  ) {
    return
  }
  state.runtime?.ingestSyntheticTitleFrame(ptyId, data)
  if (shouldCopySyntheticTitleFrameToPtyData(state.store?.getSettings())) {
    window.webContents.send('pty:data', { id: ptyId, data })
  }
}

function canSendDecorativeSyntheticTitle(): boolean {
  return shouldSendSyntheticTitleFrame({
    force: false,
    windowVisible: isSyntheticTitleWindowVisible()
  })
}

export function stopSyntheticTitleSpinner(paneKey: string): void {
  if (syntheticTitleSpinnerByPaneKey.delete(paneKey)) {
    stopSyntheticTitleSpinnerTimerIfIdle()
  }
}

export function stopAllSyntheticTitleSpinners(): void {
  syntheticTitleSpinnerByPaneKey.clear()
  stopSyntheticTitleSpinnerTimer()
}

export function stopSyntheticTitleSpinnerTimer(): void {
  if (syntheticTitleSpinnerTimer) {
    clearInterval(syntheticTitleSpinnerTimer)
    syntheticTitleSpinnerTimer = null
  }
}

function stopSyntheticTitleSpinnerTimerIfIdle(): void {
  if (syntheticTitleSpinnerByPaneKey.size === 0) {
    stopSyntheticTitleSpinnerTimer()
  }
}

function tickSyntheticTitleSpinners(): void {
  if (!canSendDecorativeSyntheticTitle()) {
    stopSyntheticTitleSpinnerTimer()
    return
  }
  const ticks = advanceSyntheticTitleSpinnerEntries({
    entries: syntheticTitleSpinnerByPaneKey,
    frameCount: SPINNER_FRAMES.length,
    getPtyIdForPaneKey
  })
  for (const tick of ticks) {
    sendSyntheticTitle(
      tick.ptyId,
      `\x1b]0;${SPINNER_FRAMES[tick.frame]} ${tick.profile.workingLabel}\x07`
    )
  }
  stopSyntheticTitleSpinnerTimerIfIdle()
}

function ensureSyntheticTitleSpinnerTimer(): void {
  if (
    syntheticTitleSpinnerTimer ||
    syntheticTitleSpinnerByPaneKey.size === 0 ||
    !canSendDecorativeSyntheticTitle()
  ) {
    return
  }
  syntheticTitleSpinnerTimer = setInterval(tickSyntheticTitleSpinners, SPINNER_INTERVAL_MS)
}

export function resumeSyntheticTitleSpinnerTimer(): void {
  ensureSyntheticTitleSpinnerTimer()
}

export function driveSyntheticTitleFromHook(
  paneKey: string,
  agentState: AgentStatusState,
  profile: SyntheticAgentTitleProfile
): void {
  const ptyId = getPtyIdForPaneKey(paneKey)
  if (!ptyId) {
    return
  }
  if (agentState === 'working') {
    const existing = syntheticTitleSpinnerByPaneKey.get(paneKey)
    const frame = existing ? existing.frame : 0
    sendSyntheticTitle(ptyId, `\x1b]0;${SPINNER_FRAMES[frame]} ${profile.workingLabel}\x07`)
    if (existing) {
      existing.profile = profile
      return
    }
    syntheticTitleSpinnerByPaneKey.set(paneKey, { frame, profile })
    ensureSyntheticTitleSpinnerTimer()
    return
  }
  stopSyntheticTitleSpinner(paneKey)
  const needsUserInput = agentState === 'blocked' || agentState === 'waiting'
  const label = needsUserInput ? profile.permissionLabel : profile.idleLabel
  sendSyntheticTitle(ptyId, `\x1b]0;${label}\x07${needsUserInput ? '\x07' : ''}`, { force: true })
}

export function shouldSuppressCodexAutoApprovalSyntheticTitleFromHook(args: {
  agentType: string | null | undefined
  state: AgentStatusState
  launchConfig:
    | { agentArgs?: string | null; agentEnv?: Record<string, string> | null }
    | null
    | undefined
}): boolean {
  if (args.agentType !== 'codex' || (args.state !== 'waiting' && args.state !== 'blocked')) {
    return false
  }
  if (!args.launchConfig) {
    return false
  }
  return (
    resolveTuiAgentPermissionMode({
      agent: 'codex',
      agentArgs: args.launchConfig.agentArgs,
      agentEnv: args.launchConfig.agentEnv
    }) === 'yolo'
  )
}

export function initializeSyntheticTitleRuntime(): void {
  registerPaneKeyTeardownListener((paneKey) => stopSyntheticTitleSpinner(paneKey))
  // Retire synthetic titles with either pane-scoped clears or explicit status drops.
  agentHookServer.subscribePaneStatusClear((clear) => {
    const paneKey = getSyntheticTitleSpinnerPaneKeyToStop(clear)
    if (paneKey) {
      stopSyntheticTitleSpinner(paneKey)
    }
  })
  agentHookServer.subscribeStatusDrop(stopSyntheticTitleSpinner)
}

export function driveSyntheticTitleForAgentStatus(
  paneKey: string,
  agentType: string | null | undefined,
  agentState: AgentStatusState
): void {
  const profile = getSyntheticAgentTitleProfile(agentType)
  if (profile && shouldDriveSyntheticAgentTitleFromHook(agentType, agentState)) {
    driveSyntheticTitleFromHook(paneKey, agentState, profile)
  }
}
