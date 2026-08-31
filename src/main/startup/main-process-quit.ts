import { app, type Event } from 'electron'
import { closeAllWatchers } from '../ipc/filesystem-watcher'
import { disposeWorktreeBaseDirectoryWatchers } from '../ipc/worktree-base-directory-watcher'
import { stopFolderRepoGitUpgradeWatch } from '../ipc/folder-repo-git-upgrade'
import { killAllPty } from '../ipc/pty'
import { disconnectDaemon, shutdownDaemon } from '../daemon/daemon-init'
import { beginSshShutdown } from '../ipc/ssh-shutdown-drain'
import { agentHookServer } from '../agent-hooks/server'
import { wslHookRelayManager } from '../agent-hooks/wsl-hook-relay-manager'
import { removeManagedAgentHooksAsync } from '../agent-hooks/managed-agent-hook-controls'
import { stopStructuredAgentSessionRuntime } from '../runtime/structured-agent-session-runtime'
import { awaitRuntimeFileWatcherUnsubscribes } from '../runtime/manta-runtime-files'
import { clearRuntimeMetadataIfOwned } from '../runtime/runtime-metadata'
import { shutdownPairedRuntimeBrowserClientHosts } from '../browser/paired-runtime-browser-client-host-runtime'
import { browserManager } from '../browser/browser-manager'
import { stopCodexStateDbBackfillRecoveries } from '../codex/codex-state-db-backfill-recovery'
import { settleTeardownWithinDeadline, settleWithinMs } from '../quit-teardown-deadline'
import { quitTeardownStartGate } from '../quit-teardown-start-gate'
import { setUnreadDockBadgeCount } from '../dock/unread-badge'
import { destroySystemTray } from '../tray/system-tray'
import { shutdownTelemetry } from '../telemetry/client'
import { shutdownObservability } from '../observability'
import { isQuittingForUpdate } from '../updater'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'
import { stopTccPromptNotice } from '../macos-tcc-prompt-notice'
import { shouldQuitWhenAllWindowsClosed } from './window-all-closed-quit-policy'
import { mainProcessState as state } from './main-process-state'
import { isDevParentShutdownRequested } from './configure-process'
import { getCanonicalUserDataPath } from '../persistence'

let daemonDisconnectDone = false
let watcherShutdownPromise: Promise<void> | null = null
const GROK_HOOK_CLEANUP_DEADLINE_MS = 2_000

function shutdownWatchersOnce(): Promise<void> {
  if (state.watcherShutdownDone) {
    return Promise.resolve()
  }
  if (!watcherShutdownPromise) {
    stopFolderRepoGitUpgradeWatch()
    watcherShutdownPromise = Promise.allSettled([
      closeAllWatchers(),
      disposeWorktreeBaseDirectoryWatchers()
    ])
      .then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error('[filesystem-watcher] shutdown failed:', result.reason)
          }
        }
      })
      .then(() => {
        state.watcherShutdownDone = true
      })
  }
  return watcherShutdownPromise
}

function installBeforeQuitHandler(): void {
  app.on('before-quit', () => {
    if (isQuittingForUpdate()) {
      recordUpdaterLifecycle('before_quit_allowed', undefined, {
        message: 'before-quit allowed for update install'
      })
    }
    state.isQuitting = true
    state.desktopRelayService?.fenceAndCloseNow()
    state.runtimeRpc?.setMobileRelayPairingProvider(null)
    state.unsubscribeAgentAwakeStatusChanges?.()
    state.unsubscribeAgentAwakeStatusChanges = null
    state.agentAwakeService?.dispose()
    state.agentAwakeService = null
    state.rateLimits?.stop()
  })
}

function installWillQuitHandler(): void {
  app.on('will-quit', (event: Event) => {
    if (daemonDisconnectDone) {
      return
    }
    if (!quitTeardownStartGate.tryStart(event)) {
      return
    }
    state.unsubscribeSystemResumeBroadcast?.()
    state.unsubscribeSystemResumeBroadcast = null
    stopTccPromptNotice()
    const updateQuitInProgress = isQuittingForUpdate()
    if (updateQuitInProgress) {
      recordUpdaterLifecycle(
        'will_quit_cleanup_started',
        { daemonTeardown: 'disconnect' },
        { message: 'will-quit cleanup for update install; daemonTeardown=disconnect' }
      )
    }
    destroySystemTray()
    state.starNag?.stop()
    state.automations?.stop()
    state.pluginKillListService = null
    state.pluginMarketplaceService = null
    state.pluginMarketplaceInstaller = null
    const pluginHostShutdown = state.pluginService?.dispose() ?? Promise.resolve()
    const codexBackfillRecoveryShutdown = stopCodexStateDbBackfillRecoveries()
    const structuredAgentSessionShutdown = stopStructuredAgentSessionRuntime()
    state.pluginService = null
    setUnreadDockBadgeCount(0)
    agentHookServer.stop()
    const grokHookCleanup =
      process.platform === 'win32'
        ? settleWithinMs(
            removeManagedAgentHooksAsync({ agents: ['grok'] }),
            GROK_HOOK_CLEANUP_DEADLINE_MS
          ).then((settled) => {
            if (settled.outcome === 'timed-out') {
              console.warn('[agent-hooks] Grok hook cleanup on quit timed out')
              return
            }
            if (settled.outcome === 'failed') {
              console.warn('[agent-hooks] Grok hook cleanup on quit failed:', settled.error)
              return
            }
            for (const status of settled.value.filter((entry) => entry.detail)) {
              console.warn(`[agent-hooks] ${status.agent} hook cleanup on quit: ${status.detail}`)
            }
          })
        : Promise.resolve()
    wslHookRelayManager.disposeAll()
    const statsFlush = state.stats?.flushAsync() ?? Promise.resolve()
    const browserShutdown = (async (): Promise<void> => {
      await state.runtime?.getOffscreenBrowserBackend()?.destroyAll?.()
      await state.runtime?.getAgentBrowserBridge()?.destroyAllSessions()
    })()
    const localSshRouteShutdown = import('../browser/local-ssh-browser-route')
      .then((routes) => routes.closeAllLocalSshBrowserRoutes())
      .catch(() => {})
    browserManager.setBrowserGuestStateChangedListener(null)
    const emulatorShutdown =
      state.runtime?.getEmulatorBridge()?.destroyAllSessions() ?? Promise.resolve()
    const sshShutdown = beginSshShutdown()
    killAllPty()
    const watcherShutdown = shutdownWatchersOnce()
    const storeFlush = state.store?.flushAsync() ?? Promise.resolve()
    const usageCacheFlush = Promise.all([
      state.claudeUsage?.flush(),
      state.codexUsage?.flush(),
      state.openCodeUsage?.flush()
    ]).then(() => {})
    const browserClientHostShutdown = shutdownPairedRuntimeBrowserClientHosts()
    const skillUploadShutdown = state.runtime?.disposeSkillUploadSessions() ?? Promise.resolve()
    const ownedPid = process.pid
    const ownedRuntimeId = state.runtime?.getRuntimeId()
    const rpcStopAndClear = state.runtimeRpc
      ? state.runtimeRpc
          .stop()
          .then(() => awaitRuntimeFileWatcherUnsubscribes())
          .then(() => {
            if (ownedRuntimeId) {
              clearRuntimeMetadataIfOwned(getCanonicalUserDataPath(), ownedPid, ownedRuntimeId)
            }
          })
          .catch((error) => console.error('[runtime] Failed to stop local RPC transport:', error))
      : Promise.resolve()
    const daemonTeardown = isDevParentShutdownRequested() ? shutdownDaemon() : disconnectDaemon()
    settleTeardownWithinDeadline([
      { name: 'daemon', promise: daemonTeardown },
      { name: 'browser', promise: browserShutdown },
      { name: 'runtime-rpc', promise: rpcStopAndClear },
      { name: 'watchers', promise: watcherShutdown },
      { name: 'emulator', promise: emulatorShutdown },
      { name: 'browser-client-hosts', promise: browserClientHostShutdown },
      { name: 'local-ssh-browser-routes', promise: localSshRouteShutdown },
      { name: 'ssh', promise: sshShutdown },
      { name: 'plugin-hosts', promise: pluginHostShutdown },
      { name: 'skill-uploads', promise: skillUploadShutdown },
      { name: 'grok-hooks', promise: grokHookCleanup },
      { name: 'codex-backfill-recovery', promise: codexBackfillRecoveryShutdown },
      { name: 'structured-agent-session', promise: structuredAgentSessionShutdown },
      { name: 'usage-cache', promise: usageCacheFlush },
      { name: 'stats', promise: statsFlush },
      { name: 'state', promise: storeFlush }
    ])
      .then((pendingTeardowns) => {
        if (pendingTeardowns.length > 0) {
          console.warn('[shutdown] Quit teardown deadline reached', { pendingTeardowns })
        }
      })
      .then(() => shutdownTelemetry())
      .then(() => shutdownObservability())
      .catch(() => {})
      .then(() => {
        daemonDisconnectDone = true
        app.quit()
      })
  })
}

function installWindowAllClosedHandler(): void {
  app.on('window-all-closed', () => {
    if (
      shouldQuitWhenAllWindowsClosed({
        platform: process.platform,
        isQuitting: state.isQuitting,
        isServeMode: state.isServeMode
      })
    ) {
      app.quit()
    }
  })
}

/** Installs the process-level shutdown listeners once during bootstrap. */
export function installMainProcessQuitHandlers(): void {
  process.once('exit', stopTccPromptNotice)
  installBeforeQuitHandler()
  installWillQuitHandler()
  installWindowAllClosedHandler()
}
