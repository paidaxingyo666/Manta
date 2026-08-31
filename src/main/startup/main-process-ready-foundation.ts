import { app, session } from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import { applyBackgroundActivationPolicy } from '../window/foreground-activation-policy'
import { applyElectronProxySettings } from '../network/proxy-settings'
import { installElectronProxyRequestGuard } from '../network/electron-proxy-request-guard'
import { handleElectronProxyLogin } from '../network/electron-proxy-credentials'
import { installMainThreadHangWatchdog } from '../hang-watchdog/main-thread-hang-watchdog'
import {
  consumeHangDetectionMarker,
  hangDetectionMarkerPath
} from '../hang-watchdog/hang-detection-marker'
import { browserCertificateTrustController } from '../browser/browser-manager'
import { ensureActiveMantaProfile } from '../manta-profiles/profile-index-store'
import { Store, getCanonicalUserDataPath } from '../persistence'
import { initializeBrowserClientHostId } from '../browser/browser-client-host-id'
import { scheduleSecretProtectionGapReport } from '../host/deferred-secret-protection-report'
import { initSshHostKeyStoreFile } from '../ssh/ssh-host-key-store'
import { neutralizeLegacyTerminalShimDir } from '../pty/legacy-terminal-shim-dir'
import { createWindowsShellPathHydration } from './windows-shell-path-hydration'
import {
  configureWindowsHostGitEnvironmentReadiness,
  setDefaultWslDistroOverride
} from '../git/runner'
import { wslHookRelayManager } from '../agent-hooks/wsl-hook-relay-manager'
import {
  attachClaudeLivePtyPersistence,
  onLiveClaudePtysDrained,
  seedLiveClaudePtysFromPersistence
} from '../claude-accounts/live-pty-gate'
import { applyAppIcon } from '../app-icon'
import {
  shouldSuppressDevEducation,
  suppressDevEducationForStore
} from './dev-education-suppression'
import { setBrowserNetworkProxySettingsResolver } from '../browser/browser-session-proxy'
import { installDocPreviewProtocolHandler } from '../browser/doc-preview-protocol'
import { registerDocPreviewGrantHandlers } from '../ipc/doc-preview-grant-ipc'
import { initializeBrowserSessionsForApp } from '../browser/browser-session-startup'
import { applyBrowserSessionProxies } from '../browser/browser-session-proxy'
import { browserSessionRegistry } from '../browser/browser-session-registry'
import { logStartupMilestone } from './startup-diagnostics'
import { mainProcessState as state } from './main-process-state'
import { recordDurableCrashBreadcrumb } from '../crash-reporting/durable-crash-breadcrumb'
import { syncMacMenuBarIcon } from './main-window-actions'
import { updateGpuAccelerationAboutPanel } from './gpu-lifecycle'
import { reconcileManagedWslCliRegistrations } from '../cli/wsl-cli-registration-reconciliation'
import { createWslCliReconciliationStartupBarrier } from './wsl-cli-reconciliation-startup-barrier'
import { isAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'

export async function initializeReadyFoundation(): Promise<void> {
  logStartupMilestone('app-ready')
  applyBackgroundActivationPolicy({ warn: console.warn })
  installElectronProxyRequestGuard(session.defaultSession)
  app.on('login', (event, webContents, details, authInfo, callback) => {
    handleElectronProxyLogin(
      event,
      webContents,
      details,
      authInfo,
      callback,
      session.defaultSession
    )
  })
  const canonicalUserDataPath = getCanonicalUserDataPath()
  installMainThreadHangWatchdog({ userDataPath: canonicalUserDataPath })
  state.hangDetection = consumeHangDetectionMarker(hangDetectionMarkerPath(canonicalUserDataPath))
  if (state.hangDetection) {
    recordDurableCrashBreadcrumb('main_thread_hang_detected', {
      unresponsiveMs: state.hangDetection.unresponsiveMs,
      previousPid: state.hangDetection.parentPid,
      selfRecovered: state.hangDetection.selfRecovered
    })
  }
  app.on(
    'certificate-error',
    (event, webContents, url, error, certificate, callback, isMainFrame) => {
      browserCertificateTrustController.handleCertificateError({
        event,
        webContents,
        url,
        error,
        certificate,
        callback,
        isMainFrame
      })
    }
  )
  const identity = state.devInstanceIdentity
  if (!identity) {
    throw new Error('Development identity is unavailable')
  }
  electronApp.setAppUserModelId(identity.appUserModelId)
  app.setName(identity.appName)
  updateGpuAccelerationAboutPanel()
  state.managedWslCliReconciliationStatus = 'pending'
  state.managedWslCliReconciliationReady = reconcileManagedWslCliRegistrations({
    isPackaged: app.isPackaged,
    userDataPath: canonicalUserDataPath,
    appVersion: app.getVersion()
  })
    .then((results) => {
      for (const result of results) {
        if (result.outcome === 'failed') {
          console.warn(
            `[wsl-cli] ${result.distro} managed registration reconciliation failed: ${result.error}`
          )
        } else if (result.outcome === 'repaired') {
          console.log(`[wsl-cli] Repaired managed registration in ${result.distro}.`)
        }
      }
      state.managedWslCliReconciliationStatus = 'settled'
    })
    .catch((error) => {
      state.managedWslCliReconciliationStatus = 'failed'
      console.warn(
        '[wsl-cli] Managed registration reconciliation discovery failed:',
        error instanceof Error ? error.message : String(error)
      )
    })
  state.managedWslCliStartupBarrierReady = createWslCliReconciliationStartupBarrier(
    state.managedWslCliReconciliationReady
  )
  const profile = ensureActiveMantaProfile()
  state.activeMantaProfile = profile
  initializeBrowserClientHostId(profile.profileDirectory)
  const store = new Store({
    dataFile: profile.dataFile,
    storageAuthority: state.isServeMode ? 'runtime' : 'desktop'
  })
  state.store = store
  const initialProxyApplication = applyElectronProxySettings(store.getSettings())
  installElectronProxyRequestGuard(session.defaultSession)
  scheduleSecretProtectionGapReport({
    dataFile: profile.dataFile,
    force: process.env.MANTA_ALWAYS_REPORT_SECRET_PROTECTION === '1',
    deferUntilFirstWindow: !state.isServeMode
  })
  initSshHostKeyStoreFile(profile.dataFile)
  neutralizeLegacyTerminalShimDir(app.getPath('userData'))
  const windowsShellPathHydration = createWindowsShellPathHydration()
  state.windowsShellPathHydration = windowsShellPathHydration
  configureWindowsHostGitEnvironmentReadiness(
    process.platform === 'win32' ? windowsShellPathHydration.whenReady : null
  )
  if (process.platform === 'win32') {
    const settings = store.getSettings()
    if (app.isPackaged) {
      void windowsShellPathHydration.hydrate(
        settings.terminalWindowsShell,
        settings.terminalWindowsPowerShellImplementation
      )
    } else {
      windowsShellPathHydration.configure(
        settings.terminalWindowsShell,
        settings.terminalWindowsPowerShellImplementation
      )
    }
  }
  wslHookRelayManager.setManagedHookSettingsResolver(() => state.store?.getSettings() ?? null)
  logStartupMilestone('store-loaded')
  setDefaultWslDistroOverride(store.getSettings().terminalWindowsWslDistro ?? null)
  store.onSettingsChanged((updates, settings) => {
    if ('terminalWindowsWslDistro' in updates) {
      setDefaultWslDistroOverride(settings.terminalWindowsWslDistro ?? null)
    }
    if (
      ('terminalWindowsShell' in updates || 'terminalWindowsPowerShellImplementation' in updates) &&
      process.platform === 'win32'
    ) {
      if (app.isPackaged) {
        void windowsShellPathHydration.hydrate(
          settings.terminalWindowsShell,
          settings.terminalWindowsPowerShellImplementation
        )
      } else {
        windowsShellPathHydration.configure(
          settings.terminalWindowsShell,
          settings.terminalWindowsPowerShellImplementation
        )
      }
    }
    if ('showMenuBarIcon' in updates) {
      syncMacMenuBarIcon(settings.showMenuBarIcon !== false)
    }
    if ('agentStatusHooksEnabled' in updates) {
      if (isAgentStatusHooksEnabled(settings)) {
        wslHookRelayManager.resumeStoppedRelays()
      } else {
        wslHookRelayManager.disposeAll({ permanent: false })
      }
    }
  })
  attachClaudeLivePtyPersistence(store)
  onLiveClaudePtysDrained(() => {
    void state.rateLimits?.refreshAfterClaudeLivePtysDrained()
  })
  const persistedClaudePtyIds = store.getClaudeLivePtySessionIds()
  seedLiveClaudePtysFromPersistence(persistedClaudePtyIds)
  if (persistedClaudePtyIds.length > 0) {
    console.log(
      `[claude-live-pty] Seeded ${persistedClaudePtyIds.length} persisted Claude session id(s) into the refresh gate`
    )
  }
  applyAppIcon(store.getSettings().appIcon)
  if (shouldSuppressDevEducation({ isDev: is.dev })) {
    suppressDevEducationForStore(store)
  }
  try {
    const proxyApplyResult = await initialProxyApplication
    if (proxyApplyResult.source === 'invalid-settings') {
      console.warn('[proxy] persisted proxy settings are invalid; using direct networking')
    }
  } catch {
    console.warn('[proxy] Failed to apply network proxy settings')
  }
  setBrowserNetworkProxySettingsResolver(() => state.store!.getSettings())
  installDocPreviewProtocolHandler()
  registerDocPreviewGrantHandlers()
  initializeBrowserSessionsForApp({
    mantaProfileId: profile.profile.id,
    profileDirectory: profile.profileDirectory,
    listLocalSshTargetIds: () => {
      const currentStore = state.store
      if (!currentStore) {
        throw new Error('ssh target store unavailable at partition sweep')
      }
      return currentStore.getSshTargets().map((target) => target.id)
    }
  })
  try {
    await applyBrowserSessionProxies(browserSessionRegistry.listProfiles(), store.getSettings())
  } catch {
    console.warn('[proxy] Failed to apply network proxy settings to browser sessions')
  }
}
