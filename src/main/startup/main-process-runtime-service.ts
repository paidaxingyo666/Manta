import { app } from 'electron'
import { MantaRuntimeService } from '../runtime/manta-runtime'
import { getLocalPtyProvider, getSshPtyProvider, clearProviderPtyState } from '../ipc/pty'
import { agentHookServer } from '../agent-hooks/server'
import { browserManager } from '../browser/browser-manager'
import { loadAgentSessionClaimSigner } from '../runtime/agent-session-claim-identity'
import { getProfileUserDataPath } from '../manta-profiles/profile-storage-paths'
import { prepareCodexAiVaultSessionResume } from '../codex/codex-ai-vault-session-resume'
import { resolveHostCodexSessionSourceHome } from '../codex/codex-session-source-home'
import { isAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import { getDaemonProvider } from '../daemon/daemon-init'
import type { TerminalSideEffectBatch } from '../../shared/terminal-side-effect-facts'
import type { OrchestrationEnvironmentTransport } from '../runtime/orchestration/environment-transport'
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import { fingerprintOrchestrationPeer } from '../runtime/orchestration/environment-transport'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'
import { mainProcessState as state } from './main-process-state'
import { prepareCodexRuntimeHomeForLaunch } from './codex-launch-preparation'
import type { RuntimeDesktopWindowStatus } from '../../shared/runtime-types'
import { ArtifactCloudService } from '../artifacts/artifact-cloud-service'
import { SkillCloudService } from '../skills/skill-cloud-service'
import { isArtifactSharingEnabled } from '../../shared/artifact-sharing-gate'

export function getDesktopWindowStatus(): RuntimeDesktopWindowStatus {
  const activation = state.desktopActivationGate
  if (!activation) {
    return 'available'
  }
  const value = activation.getState()
  return value === 'ready' ? 'openable' : value
}

export function initializeMainProcessRuntime(): MantaRuntimeService {
  const store = state.store
  const stats = state.stats
  if (!store || !stats) {
    throw new Error('Store and stats must be initialized before runtime')
  }
  const orchestrationEnvironmentTransport: OrchestrationEnvironmentTransport = {
    resolve: (selector) => {
      const environment = resolveEnvironment(app.getPath('userData'), selector)
      const pairing = getPreferredPairingOffer(environment)
      return {
        environmentId: environment.id,
        name: environment.name,
        peerFingerprint: fingerprintOrchestrationPeer(pairing.publicKeyB64)
      }
    },
    call: (selector, method, params, timeoutMs, envelope) =>
      callRuntimeEnvironment(
        app.getPath('userData'),
        selector,
        method,
        params,
        timeoutMs,
        undefined,
        envelope
      )
  }
  const runtime = new MantaRuntimeService(store, stats, {
    agentSessionClaimSigner: loadAgentSessionClaimSigner(
      getProfileUserDataPath(),
      getProfileUserDataPath()
    ),
    getLocalProvider: () => getLocalPtyProvider(),
    getSshProvider: (connectionId) => getSshPtyProvider(connectionId),
    onPtyStopped: clearProviderPtyState,
    onTerminalAgentStatus: (event) => agentHookServer.ingestTerminalStatus(event),
    onTerminalSideEffects: (batch: TerminalSideEffectBatch) => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('pty:sideEffect', batch)
      }
    },
    getDesktopWindowStatus,
    getAgentStatusSnapshot: () =>
      agentHookServer.getStatusSnapshot().filter((entry) => entry.providerSessionOnly !== true),
    getAgentProviderSessionSnapshot: () => agentHookServer.getStatusSnapshot(),
    getAgentProviderSessionRowsForPane: (paneKey) =>
      agentHookServer.getStatusSnapshotForPane(paneKey),
    attestAgentHookCompatibilityAuthority: (candidate) =>
      agentHookServer.attestCompatibilityAuthority(candidate),
    retireAgentHookCompatibilityAuthority: (paneKey) =>
      agentHookServer.retirePaneAuthority(paneKey),
    reconcileAgentStatusForEndedProcess: (paneKeys) =>
      agentHookServer.reconcileEndedProcessForPaneKeys(paneKeys),
    canRecoverPersistentLocalPtys: () => getDaemonProvider() !== null,
    getPairedDeviceName: (pairedDeviceId) =>
      state.runtimeRpc?.getDeviceRegistry()?.getDevice(pairedDeviceId)?.name ?? null,
    getAdditionalAiVaultCodexHomePaths: () =>
      state.codexRuntimeHome?.getHostCodexHomePathsForSessionDiscovery() ?? [],
    prepareAiVaultSessionResume: (args) =>
      prepareCodexAiVaultSessionResume(args, {
        runtimeHome: state.codexRuntimeHome,
        systemCodexHomePath: resolveHostCodexSessionSourceHome(store.getSettings())
      }),
    prepareCodexStructuredLaunch: ({ workspacePath, launchEnv }) =>
      prepareCodexRuntimeHomeForLaunch(undefined, launchEnv, {
        launchAgent: 'codex',
        workspacePath
      }),
    buildAgentHookPtyEnv: () =>
      isAgentStatusHooksEnabled(state.store?.getSettings()) ? agentHookServer.buildPtyEnv() : {},
    orchestrationEnvironmentTransport,
    skillTransactionRecovery: state.skillTransactionRecovery
  })
  state.runtime = runtime
  runtime.prepareLegacyWorkerTerminalRecovery()
  runtime.rehydrateClientHostedBrowserPages()
  state.publishProviderSessionChanges?.(agentHookServer.getProviderSessionIdentities())
  browserManager.setBrowserGuestStateChangedListener((worktreeId) => {
    runtime.notifyMobileSessionTabsChanged(worktreeId)
  })
  return runtime
}

export function configureRuntimeServices(runtime: MantaRuntimeService): void {
  const store = state.store
  const claudeAccounts = state.claudeAccounts
  const codexAccounts = state.codexAccounts
  const rateLimits = state.rateLimits
  if (!store || !claudeAccounts || !codexAccounts || !rateLimits) {
    throw new Error('Account services must be initialized before runtime wiring')
  }
  runtime.setArtifactService(
    new ArtifactCloudService(app.getPath('userData'), () =>
      isArtifactSharingEnabled(state.store?.getSettings())
    )
  )
  runtime.setSkillCloudService(new SkillCloudService(app.getPath('userData')))
  runtime.setAccountServices({ claudeAccounts, codexAccounts, rateLimits })
  runtime.setCommitMessageAgentEnvironmentResolvers({
    prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch,
    prepareForClaudeLaunch: (target) => state.claudeRuntimeAuth!.prepareForClaudeLaunch(target)
  })
}
