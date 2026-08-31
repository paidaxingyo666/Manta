import { app } from 'electron'
import { join } from 'node:path'
import { AgentAwakeService } from '../agent-awake-service'
import { normalizeComputerAwakeMode } from '../../shared/computer-awake-mode'
import { registerSystemResumeBroadcast } from '../system-resume-broadcast'
import { agentHookServer, type AgentHookProviderSessionIdentity } from '../agent-hooks/server'
import { createHookProviderSessionInvalidator } from '../agent-hooks/hook-provider-session-invalidation'
import { createHookStatusSessionTabsInvalidator } from '../agent-hooks/hook-status-session-tabs-invalidation'
import { initTelemetry, track } from '../telemetry/client'
import { setCodexTrustGrantTelemetry } from '../codex/codex-trust-grant-telemetry'
import { initObservability } from '../observability'
import { recordDurableCrashBreadcrumb } from '../crash-reporting/durable-crash-breadcrumb'
import { recoverPendingSkillTransactions } from '../skills/skill-transaction-startup-recovery'
import { initCohortClassifier } from '../telemetry/cohort-classifier'
import { initOnboardingCohortClassifier } from '../telemetry/onboarding-cohort-classifier'
import { StatsCollector } from '../stats/collector'
import { AgentSessionTransitionRecorder } from '../stats/agent-session-transition-recorder'
import { ClaudeUsageStore } from '../claude-usage/store'
import { CodexUsageStore } from '../codex-usage/store'
import { OpenCodeUsageStore } from '../opencode-usage/store'
import { mainProcessState as state } from './main-process-state'

export function initializeMainProcessObservers(): void {
  const store = state.store
  const runtime = state.runtime
  if (!store) {
    throw new Error('Store must be initialized before observers')
  }
  state.unsubscribeSystemResumeBroadcast = registerSystemResumeBroadcast()
  state.agentAwakeService = new AgentAwakeService()
  state.agentAwakeService.setMode(
    normalizeComputerAwakeMode(
      store.getSettings().computerAwakeMode,
      store.getSettings().keepComputerAwakeWhileAgentsRun
    )
  )
  state.agentAwakeService.setStatuses([])
  const collectChangedProviderSessionWorktrees = createHookProviderSessionInvalidator()
  const publishProviderSessionChanges = (identities: AgentHookProviderSessionIdentity[]): void => {
    const ownedIdentities = identities.map((identity) => ({
      ...identity,
      worktreeId:
        identity.worktreeId ??
        runtime?.getTerminalWorktreeIdForPaneKey(identity.paneKey) ??
        undefined
    }))
    for (const worktreeId of collectChangedProviderSessionWorktrees(ownedIdentities)) {
      runtime?.touchMobileSessionTabsForWorktree(worktreeId, { immediate: true })
    }
  }
  state.publishProviderSessionChanges = publishProviderSessionChanges
  const unsubscribeStatusChanges = agentHookServer.subscribeStatusChanges((statuses) => {
    state.agentAwakeService?.setStatuses(statuses)
  })
  const unsubscribeProviderSessionChanges = agentHookServer.subscribeProviderSessionChanges(
    (sessions) => publishProviderSessionChanges(sessions)
  )
  const hookStatusChangedSessionTabs = createHookStatusSessionTabsInvalidator()
  const unsubscribeHookStatusSessionTabs = agentHookServer.subscribeEnrichedStatus((enriched) => {
    if (hookStatusChangedSessionTabs(enriched)) {
      runtime?.touchMobileSessionTabsForPane(enriched.paneKey, enriched.worktreeId ?? null)
    }
  })
  const unsubscribeHookStatusClear = agentHookServer.subscribePaneStatusClear((clear) => {
    const clearedPaneKeys =
      'paneKey' in clear
        ? [clear.paneKey]
        : hookStatusChangedSessionTabs.forgetConnection(clear.connectionId)
    for (const paneKey of clearedPaneKeys) {
      hookStatusChangedSessionTabs.forgetPane(paneKey)
      runtime?.touchMobileSessionTabsForPane(paneKey)
    }
  })
  state.unsubscribeAgentAwakeStatusChanges = () => {
    unsubscribeStatusChanges()
    unsubscribeProviderSessionChanges()
    unsubscribeHookStatusSessionTabs()
    unsubscribeHookStatusClear()
  }
  initTelemetry(store)
  if (state.hangDetection) {
    track('main_thread_hang_detected', {
      unresponsive_ms: Math.round(state.hangDetection.unresponsiveMs),
      self_recovered: state.hangDetection.selfRecovered
    })
  }
  setCodexTrustGrantTelemetry(({ outcome, hostKind, lane, reason, errorClass, verifyClass }) => {
    track('codex_trust_grant', {
      outcome,
      host_kind: hostKind,
      lane,
      ...(reason !== undefined ? { fallback_reason: reason } : {}),
      ...(errorClass !== undefined ? { error_class: errorClass } : {}),
      ...(verifyClass !== undefined ? { verify_class: verifyClass } : {})
    })
  })
  initObservability()
  recordDurableCrashBreadcrumb('main_process_lifecycle_started', {
    packaged: app.isPackaged,
    platform: process.platform
  })
  state.skillTransactionRecovery = recoverPendingSkillTransactions(
    join(app.getPath('userData'), 'skill-installs')
  )
  void state.skillTransactionRecovery
    .then((report) => {
      const result = report as {
        scanned: number
        recovered: number
        failures: { code: string }[]
        truncated: boolean
      }
      if (result.scanned || result.failures.length || result.truncated) {
        console.info('[skills] startup transaction recovery:', {
          scanned: result.scanned,
          recovered: result.recovered,
          failures: result.failures.map((failure) => failure.code),
          truncated: result.truncated
        })
      }
    })
    .catch((error) => console.warn('[skills] startup transaction recovery failed:', error))
  initCohortClassifier(store)
  initOnboardingCohortClassifier(store)
  state.stats = new StatsCollector()
  const agentSessionRecorder = new AgentSessionTransitionRecorder(state.stats)
  agentHookServer.subscribeEnrichedStatus((enriched) => agentSessionRecorder.onStatus(enriched))
  agentHookServer.subscribePaneStatusClear((clear) => agentSessionRecorder.onCleared(clear))
  state.claudeUsage = new ClaudeUsageStore(store)
  state.codexUsage = new CodexUsageStore(store)
  state.openCodeUsage = new OpenCodeUsageStore(store)
}
