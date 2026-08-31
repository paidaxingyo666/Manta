import { app } from 'electron'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import type { CodexSessionResumePreparation } from '../codex/codex-session-resume-home'
import { prepareCodexSessionResume } from '../codex/codex-session-resume-preparation'
import { prepareLegacySharedCodexSessionResume } from '../codex/codex-legacy-session-resume'
import { ManagedCodexHomeTemporarilyUnavailableError } from '../codex-accounts/host-codex-managed-home-ownership'
import { codexHookService } from '../codex/hook-service'
import { ensureRealHomeCodexHookState } from '../codex/codex-real-home-hook-install'
import { isAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import { markCodexProjectTrusted } from '../agent-trust-presets'
import { getMantaManagedCodexHomePath, getSystemCodexHomePath } from '../codex/codex-home-paths'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { mainProcessState as state } from './main-process-state'

export async function prepareCodexSessionResumeForLaunch(args: {
  providerSession: AgentProviderSessionMetadata
  target: CodexAccountSelectionTarget
  launchEnv?: NodeJS.ProcessEnv
  workspacePath?: string
}): Promise<CodexSessionResumePreparation | null> {
  const runtimeHome = state.codexRuntimeHome
  const store = state.store
  if (args.target.runtime === 'wsl' || !runtimeHome || !store) {
    return null
  }
  const systemHomePath = getSystemCodexHomePath()
  const trustedHomes = [systemHomePath, ...runtimeHome.getHostCodexHomePathsForSessionDiscovery()]
  const selectedAccountCodexHome = runtimeHome.resolveSelectedHostAccountCodexHomePathForResume()
  const preparation = await prepareCodexSessionResume({
    sessionId: args.providerSession.id,
    transcriptPath: args.providerSession.transcriptPath,
    trustedCodexHomes: trustedHomes,
    getSelectedAccountCodexHome: () => selectedAccountCodexHome,
    systemCodexHomePath: systemHomePath,
    sharedRuntimeCodexHomePath: getMantaManagedCodexHomePath(),
    resolveVerifiedResumeHome: async (sessionSource) => {
      let migrated = { useRealCodexHome: false }
      try {
        migrated = await prepareLegacySharedCodexSessionResume(
          {
            agent: 'codex',
            executionHostId: 'local',
            filePath: sessionSource.transcriptPath,
            codexHome: sessionSource.homePath
          },
          {
            isHostSystemDefaultRealHome: () => runtimeHome.isHostSystemDefaultRealHome(),
            systemCodexHomePath: systemHomePath
          }
        )
      } catch (error) {
        if (error instanceof ManagedCodexHomeTemporarilyUnavailableError) {
          throw error
        }
        console.warn(
          '[codex-session-resume] Legacy rollout migration failed; using origin home:',
          error
        )
      }
      const resumeHome = migrated.useRealCodexHome ? systemHomePath : sessionSource.homePath
      if (args.workspacePath) {
        try {
          await markCodexProjectTrusted(args.workspacePath)
        } catch (error) {
          console.warn('[codex-project-trust] failed to pre-mark resumed workspace:', error)
        }
      }
      const isSystemHome =
        normalizeRuntimePathForComparison(resumeHome) ===
        normalizeRuntimePathForComparison(systemHomePath)
      const hooksEnabled = isAgentStatusHooksEnabled(store.getSettings())
      try {
        if (isSystemHome) {
          await ensureRealHomeCodexHookState({
            hooksEnabled,
            userDataPath: app.getPath('userData')
          })
        } else if (hooksEnabled) {
          await codexHookService.installForLaunchPrep(resumeHome)
        } else {
          await codexHookService.refreshRuntimeUserHooksForLaunchPrep(resumeHome)
        }
      } catch (error) {
        console.warn('[codex-hook-service] failed to prepare automatic resume home:', error)
      }
      return resumeHome
    }
  })
  return preparation.outcome === 'resume'
    ? {
        ...preparation,
        reconcileSharedRuntimeAuth:
          normalizeRuntimePathForComparison(preparation.codexHomePath) ===
          normalizeRuntimePathForComparison(getMantaManagedCodexHomePath())
      }
    : preparation
}
