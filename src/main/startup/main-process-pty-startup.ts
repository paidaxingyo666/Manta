import { app } from 'electron'
import { classifyError } from '../telemetry/classify-error'
import { track } from '../telemetry/client'
import { getPtyIdForPaneKey } from '../ipc/pty'
import {
  getDaemonProvider,
  initDaemonPtyProvider,
  listLiveDaemonPtyIds
} from '../daemon/daemon-init'
import {
  getCodexPaneAccount,
  hasAnyRecordedLegacyWslCodexPane,
  hasRecordedManagedHostCodexPane,
  isCodexPaneHomeRouteProvenAwayFromSharedHome,
  reconcileCodexPaneAccountsWithLivePtys,
  type CodexPaneHomeRoute
} from '../codex/codex-pane-account-registry'
import { reconcileRetainedCodexHookHomes } from '../codex/retained-codex-hook-state'
import { codexHookService } from '../codex/hook-service'
import { isAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import { agentHookServer } from '../agent-hooks/server'
import {
  indexPersistedPaneKeyPtyIds,
  isLocalExecutionHost,
  resolveAgentWorkspaceExecutionHostId,
  sweepRestoredSubagentsWithoutLiveAgent
} from '../agent-hooks/restored-subagent-liveness-sweep'
import { startFirstWindowStartupServices } from './first-window-startup-services'
import { logStartupMilestone } from './startup-diagnostics'
import type { WindowsDesktopStartupServices } from './windows-desktop-shell-path-startup'
import type { RuntimeWorktreeLifecycleEvent } from '../runtime/manta-runtime'
import { mainProcessState as state } from './main-process-state'

export function emitPluginWorktreeLifecycle(event: RuntimeWorktreeLifecycleEvent): void {
  state.pluginService?.emitEvent(
    event.kind === 'created' ? 'worktree.created' : 'worktree.removed',
    event.kind === 'created'
      ? { worktreeId: event.worktreeId, path: event.path, branch: event.branch }
      : { worktreeId: event.worktreeId, path: event.path }
  )
}

export function handleCodexHomePtySpawned(args: {
  id: string
  codexHomePath: string | null
  reattached?: boolean
  reattachedHomeRoute?: CodexPaneHomeRoute | null
  launchEnv?: NodeJS.ProcessEnv
  startedAt?: Date
  startedSequence?: number
}): void {
  if (args.reattached && args.startedSequence !== undefined) {
    const paneAccount = getCodexPaneAccount(args.id)
    const homeRoute =
      args.reattachedHomeRoute !== undefined
        ? (args.reattachedHomeRoute ?? undefined)
        : paneAccount?.homeRoute
    if (state.codexSessionMigration && isCodexPaneHomeRouteProvenAwayFromSharedHome(homeRoute)) {
      state.codexSessionMigration.ignoreLaunch(args.id, args.startedSequence)
      return
    }
  }
  const fullScanRequired =
    state.codexRuntimeHome?.beginHostSystemDefaultSessionMigrationLaunch(args.codexHomePath, {
      reattached: args.reattached,
      launchEnv: args.launchEnv
    }) ?? null
  if (fullScanRequired !== null) {
    state.codexSessionMigration?.beginLaunch(
      args.id,
      args.reattached === true || fullScanRequired,
      args.startedAt,
      args.startedSequence
    )
  }
}

export function handlePtyExit(id: string, exitSequence: number): void {
  state.codexSessionMigration?.finishLaunch(id, exitSequence)
}

export async function reapRestoredSubagentsWithoutLiveAgent(): Promise<void> {
  const store = state.store
  if (!store) {
    return
  }
  const provider = getDaemonProvider()
  if (!provider) {
    return
  }
  const persistedPtyIdByPaneKey = indexPersistedPaneKeyPtyIds(
    store.getWorkspaceSession().terminalLayoutsByTabId ?? {}
  )
  await sweepRestoredSubagentsWithoutLiveAgent({
    probeLiveLocalPty: (ptyId) => provider.probePtyLiveness(ptyId),
    isLocalExecutionHost: (worktreeId) =>
      isLocalExecutionHost(
        resolveAgentWorkspaceExecutionHostId(worktreeId, {
          getRepo: (repoId) => store.getRepo(repoId),
          getWorktreeMeta: (resolvedWorktreeId) => store.getWorktreeMeta(resolvedWorktreeId),
          getFolderWorkspace: (folderWorkspaceId) => store.getFolderWorkspace(folderWorkspaceId),
          getProjectGroups: () => store.getProjectGroups()
        })
      ),
    getBoundPtyIdForPaneKey: getPtyIdForPaneKey,
    getPersistedPtyIdForPaneKey: (paneKey) => persistedPtyIdByPaneKey.get(paneKey),
    reap: (isLocalHost, isLocalPaneAgentLive, isLocalPaneLivenessEvidenceCurrent) =>
      agentHookServer.reapRestoredClaudeSubagentsWithoutLiveAgent(
        isLocalHost,
        isLocalPaneAgentLive,
        isLocalPaneLivenessEvidenceCurrent
      )
  })
}

export function startTerminalRuntimeStartupServices(): WindowsDesktopStartupServices {
  logStartupMilestone('first-window-startup-services-start')
  const startupServices = startFirstWindowStartupServices({
    // Why: both desktop and headless serve must adopt the same persistent provider before creating terminals or a renderer.
    startDaemonPtyProvider: async (signal) => {
      logStartupMilestone('startup-service-start', { service: 'daemon-pty-provider' })
      await initDaemonPtyProvider(signal, {
        macosLoginSessionWatch: process.platform === 'darwin' && !state.isServeMode
      })
      const hasRetainedManagedHostPane = hasRecordedManagedHostCodexPane()
      if (
        state.codexRuntimeHome &&
        (hasRetainedManagedHostPane || hasAnyRecordedLegacyWslCodexPane())
      ) {
        const livePtyIds = await listLiveDaemonPtyIds()
        if (livePtyIds) {
          reconcileCodexPaneAccountsWithLivePtys(livePtyIds)
          const settings = state.store?.getSettings()
          if (hasRetainedManagedHostPane) {
            void reconcileRetainedCodexHookHomes({
              hookService: codexHookService,
              hooksEnabled:
                isAgentStatusHooksEnabled(settings) &&
                settings?.disabledTuiAgents.includes('codex') !== true,
              runtimeHomePaths: state.codexRuntimeHome.getRetainedHostCodexHookHomePaths(livePtyIds)
            }).catch((error) =>
              console.warn('[codex-hook-service] retained Codex home reconcile failed:', error)
            )
          }
        }
      }
      state.codexRuntimeHome?.reconcileLegacySharedHomeForRetainedPanes()
      logStartupMilestone('startup-service-done', { service: 'daemon-pty-provider' })
    },
    startAgentHookServer: async () => {
      const settings = state.store?.getSettings()
      if (!isAgentStatusHooksEnabled(settings)) {
        return
      }
      logStartupMilestone('startup-service-start', { service: 'agent-hook-server' })
      agentHookServer.setTransportInterferenceListener((report) => {
        track('agent_hook_transport_blocked', { count: report.count })
      })
      await agentHookServer.start({
        env: app.isPackaged ? 'production' : 'development',
        userDataPath: app.getPath('userData'),
        endpointNamespace: state.devAgentHookEndpointNamespace
      })
      logStartupMilestone('startup-service-done', { service: 'agent-hook-server' })
    },
    onDaemonError: (error) => {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(
        `[daemon] STARTUP FAILED — falling back to local PTYs; terminals will not persist across quit. Reason: ${reason}`
      )
      track('daemon_start_failed', classifyError(error))
    },
    onAgentHookServerError: (error) => {
      console.error('[agent-hooks] Failed to start local hook server:', error)
    }
  })
  void startupServices.firstWindowReady.then(() =>
    logStartupMilestone('first-window-startup-services-ready')
  )
  void startupServices.localPtyReady.then(() => {
    logStartupMilestone('local-pty-startup-ready')
    void reapRestoredSubagentsWithoutLiveAgent().catch((error) =>
      console.warn('[agent-hooks] restored-subagent liveness probe failed:', error)
    )
  })
  return startupServices
}

export function bindTerminalRuntimeStartupServices(
  services: Promise<WindowsDesktopStartupServices>
): void {
  state.firstWindowStartupServicesReady = services.then((value) => value.firstWindowReady)
  state.localPtyStartupReady = services.then((value) => value.localPtyReady)
  state.localPtyProviderStartupReady = services.then((value) => value.localPtyProviderReady)
}
