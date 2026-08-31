import { app, powerMonitor, type BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getMantaCloudAuthConfig } from '../manta-profiles/profile-cloud-auth-config'
import { getProfileUserDataPath } from '../manta-profiles/profile-storage-paths'
import {
  getCanonicalUserDataPath,
  migrateMobilePairingDataToCanonicalUserDataPath
} from '../persistence'
import { MantaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { registerMobileHandlers } from '../ipc/mobile'
import { getLocalPtyProvider, registerHeadlessPtyRuntime } from '../ipc/pty'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-types'
import { OffscreenBrowserBackend } from '../browser/offscreen-browser-backend'
import { browserManager } from '../browser/browser-manager'
import { DesktopRelayService } from '../runtime/relay/desktop-relay-service'
import { getServeOptions, getBundledWebClientRoot, printServeReady } from './main-process-serve'
import {
  bindTerminalRuntimeStartupServices,
  handleCodexHomePtySpawned,
  handlePtyExit,
  startTerminalRuntimeStartupServices
} from './main-process-pty-startup'
import { prepareCodexRuntimeHomeForLaunch } from './codex-launch-preparation'
import { prepareCodexSessionResumeForLaunch } from './codex-session-resume-launch'
import { startWindowsDesktopBeforeShellPathReady } from './windows-desktop-shell-path-startup'
import { registerServeSignalHandlers } from './serve-signal-handlers'
import { settleServeDesktopActivation } from './serve-desktop-activation'
import {
  recordRuntimeRpcStartFailure,
  showRuntimeRpcStartupFailureDialog
} from '../runtime/runtime-rpc-startup-failure'
import { CliInstaller } from '../cli/cli-installer'
import { installLinuxBareMantaDispatcher } from '../cli/linux-bare-manta-dispatcher'
import { scheduleAllPendingHistoryTreeRemovals } from '../terminal-history-deletion'
import { triggerStartupNotificationRegistration } from '../ipc/startup-notification-registration'
import { mainProcessState as state } from './main-process-state'
import { logStartupMilestone } from './startup-diagnostics'

type RuntimeService = NonNullable<typeof state.runtime>

export type MainProcessRuntimeLaunchOptions = {
  openMainWindow: (options?: { revealOnDidFinishLoad?: boolean }) => BrowserWindow
  handleMacAppActivation: () => void
}

function settleDesktopActivation(): void {
  const gate = state.desktopActivationGate
  if (!gate) {
    return
  }
  settleServeDesktopActivation(gate, {
    hasPersistentPtyProvider: !(getLocalPtyProvider() instanceof LocalPtyProvider)
  })
}

function installRuntimeRpc(
  runtime: RuntimeService,
  serveOptions: ReturnType<typeof getServeOptions> | null
): MantaRuntimeRpcServer {
  migrateMobilePairingDataToCanonicalUserDataPath(app.getPath('userData'))
  const isE2E = Boolean(process.env.MANTA_E2E_USER_DATA_DIR)
  const requestedE2EWsPort = process.env.MANTA_E2E_RUNTIME_WS_PORT
  const e2eWsPort = requestedE2EWsPort === undefined ? 0 : Number(requestedE2EWsPort)
  if (isE2E && (!Number.isInteger(e2eWsPort) || e2eWsPort < 0 || e2eWsPort > 65_535)) {
    throw new Error(`Invalid MANTA_E2E_RUNTIME_WS_PORT value: ${requestedE2EWsPort}`)
  }
  const devWsPort = is.dev && !isE2E ? 6769 : undefined
  const runtimeRpc = new MantaRuntimeRpcServer({
    runtime,
    userDataPath: getCanonicalUserDataPath(),
    enableWebSocket: true,
    exposeNetworkByDefault: Boolean(serveOptions) || isE2E,
    ...(isE2E ? { wsPort: e2eWsPort } : {}),
    ...(devWsPort !== undefined ? { wsPort: devWsPort } : {}),
    ...(serveOptions?.wsPort !== undefined
      ? { wsPort: serveOptions.wsPort, preferPinnedWsPort: true }
      : {}),
    webClientRoot: getBundledWebClientRoot()
  })
  state.runtimeRpc = runtimeRpc
  registerMobileHandlers(runtimeRpc, {
    getRelayStatus: () => state.desktopRelayStatus,
    consumePendingUnpairedDeviceAuthFailure: (webContentsId) => {
      if (
        !state.mainWindow ||
        state.mainWindow.isDestroyed() ||
        state.mainWindow.webContents.id !== webContentsId ||
        !state.pendingUnpairedDeviceAuthFailure
      ) {
        return false
      }
      state.pendingUnpairedDeviceAuthFailure = false
      return true
    }
  })
  runtimeRpc.setOnUnpairedDeviceAuthFailure(() => {
    state.pendingUnpairedDeviceAuthFailure = true
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('mobile:unpairedDeviceAuthFailure')
    }
  })
  return runtimeRpc
}

async function launchServeMode(
  runtime: RuntimeService,
  runtimeRpc: MantaRuntimeRpcServer,
  serveOptions: NonNullable<ReturnType<typeof getServeOptions>>
): Promise<void> {
  logStartupMilestone('wsl-cli-barrier-start')
  await state.managedWslCliStartupBarrierReady
  logStartupMilestone('wsl-cli-barrier-resolved', {
    reconciliation: state.managedWslCliReconciliationStatus
  })
  await state.localPtyStartupReady
  await state.localPtyProviderStartupReady
  await registerHeadlessPtyRuntime(
    runtime,
    prepareCodexRuntimeHomeForLaunch,
    () => state.store!.getSettings(),
    (target) => state.claudeRuntimeAuth!.prepareForClaudeLaunch(target),
    state.store!,
    prepareCodexSessionResumeForLaunch,
    { onCodexHomePtySpawned: handleCodexHomePtySpawned, onPtyExit: handlePtyExit }
  )
  await runtime.refreshRestoredOrchestrationAuthority()
  await runtime.reconcileLegacyWorkerTerminals()
  if (state.headlessBrowserDisplayAvailable) {
    runtime.setOffscreenBrowserBackend(
      new OffscreenBrowserBackend(browserManager, {
        getAgentBrowserBridge: () => state.agentBrowserBridge
      })
    )
  }
  runtime.syncWindowGraph(HEADLESS_RUNTIME_WINDOW_ID, { tabs: [], leaves: [] })
  await runtimeRpc.start().catch((error) => {
    console.error('[runtime] Failed to start headless RPC transport:', error)
    throw error
  })
  settleDesktopActivation()
  registerServeSignalHandlers(process, () => app.quit())
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      const cliStatus = await new CliInstaller({
        privilegedRunner: async () => {
          throw new Error('serve CLI auto-install must not request administrator privileges')
        }
      }).install()
      console.log(
        `[serve] manta CLI install: ${cliStatus.state}${cliStatus.commandPath ? ` (${cliStatus.commandPath})` : ''}`
      )
    } catch (error) {
      console.warn(
        '[serve] manta CLI install skipped:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  if (process.platform === 'linux' && app.isPackaged && process.resourcesPath) {
    try {
      const dispatcher = await installLinuxBareMantaDispatcher({
        resourcesPath: process.resourcesPath
      })
      console.log(
        `[serve] bare manta dispatcher ${dispatcher.state}: ${dispatcher.dispatcherPath}` +
          `${dispatcher.target ? ` -> ${dispatcher.target}` : ''}`
      )
    } catch (error) {
      console.warn(
        '[serve] bare manta dispatcher install skipped:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  state.automations?.start()
  scheduleAllPendingHistoryTreeRemovals()
  await printServeReady(serveOptions)
}

async function launchDesktopMode(
  runtimeRpc: MantaRuntimeRpcServer,
  shellPathReady: Promise<void>,
  desktopWindow: BrowserWindow | null,
  openMainWindow: MainProcessRuntimeLaunchOptions['openMainWindow']
): Promise<void> {
  // Preserve the pre-split startup failure contract if composition ever hands
  // this phase an incomplete runtime graph.
  if (!runtimeRpc) {
    throw new Error('runtime_rpc_unavailable')
  }
  const [win, runtimeRpcStartResult] = await Promise.all([
    Promise.resolve(desktopWindow ?? openMainWindow()),
    shellPathReady
      .then(() => runtimeRpc.start())
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => {
          recordRuntimeRpcStartFailure(error)
          return { ok: false as const, error }
        }
      )
  ])
  if (!runtimeRpcStartResult.ok) {
    void showRuntimeRpcStartupFailureDialog(win, runtimeRpcStartResult.error)
  }
  const cloudAuth = getMantaCloudAuthConfig()
  if (cloudAuth.configured) {
    try {
      const relayService = new DesktopRelayService({
        authConfig: cloudAuth.config,
        userDataPath: getProfileUserDataPath(),
        appVersion: app.getVersion(),
        runtimeRpc,
        onStatus: (status) => {
          state.desktopRelayStatus = status
          state.mainWindow?.webContents.send('mobile:relayStatusChanged', status)
        }
      })
      state.desktopRelayService = relayService
      runtimeRpc.setMobileRelayPairingProvider({
        createPairingRelay: (relayDeviceId) => relayService.createPairingRelay(relayDeviceId),
        onDeviceRevokeQueued: (item) => relayService.onDeviceRevokeQueued(item),
        onDemandStateChanged: () => relayService.demandStateChanged(),
        getEndpoints: (context, params) => relayService.getEndpoints(context, params),
        provisionRelay: (context, params) => relayService.provisionRelay(context, params)
      })
      relayService.start()
      powerMonitor.on('resume', () => state.desktopRelayService?.ensureLive())
    } catch (error) {
      console.warn(
        '[relay] Desktop relay startup unavailable:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  win.once('show', () => {
    const store = state.store
    if (store && store.getOnboarding().closedAt !== null) {
      triggerStartupNotificationRegistration(store)
    }
  })
}

export async function initializeMainProcessRuntimeLaunch(
  options: MainProcessRuntimeLaunchOptions
): Promise<void> {
  const runtime = state.runtime
  const shellPathHydration = state.windowsShellPathHydration
  if (!runtime || !shellPathHydration) {
    throw new Error('Runtime and shell-path services must be initialized before launch')
  }
  let serveOptions: ReturnType<typeof getServeOptions> | null = null
  try {
    serveOptions = state.isServeMode ? getServeOptions() : null
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    app.exit(1)
    return
  }
  state.serveOptions = serveOptions
  const runtimeRpc = installRuntimeRpc(runtime, serveOptions)
  const shellPathReady = shellPathHydration.whenReady()
  let desktopWindow: BrowserWindow | null = null
  if (process.platform === 'win32' && app.isPackaged && !serveOptions) {
    const desktopStartup = startWindowsDesktopBeforeShellPathReady({
      bindServices: bindTerminalRuntimeStartupServices,
      openWindow: () => options.openMainWindow({ revealOnDidFinishLoad: true }),
      shellPathReady,
      startServices: startTerminalRuntimeStartupServices
    })
    desktopWindow = desktopStartup.window
  } else {
    await shellPathReady
    bindTerminalRuntimeStartupServices(Promise.resolve(startTerminalRuntimeStartupServices()))
  }
  app.on('activate', options.handleMacAppActivation)
  if (serveOptions) {
    await launchServeMode(runtime, runtimeRpc, serveOptions)
    return
  }
  await launchDesktopMode(runtimeRpc, shellPathReady, desktopWindow, options.openMainWindow)
}
