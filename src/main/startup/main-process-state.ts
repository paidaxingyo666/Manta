import type { BrowserWindow, Tray } from 'electron'
import { app } from 'electron'
import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import type { OpenCodeUsageStore } from '../opencode-usage/store'
import type { CodexAccountService } from '../codex-accounts/service'
import type { CodexRuntimeHomeService } from '../codex-accounts/runtime-home-service'
import type { ClaudeAccountService } from '../claude-accounts/service'
import type { ClaudeRuntimeAuthService } from '../claude-accounts/runtime-auth-service'
import type { MantaRuntimeService } from '../runtime/manta-runtime'
import type { RateLimitService } from '../rate-limits/service'
import type { MantaRuntimeRpcServer } from '../runtime/runtime-rpc'
import type { DesktopRelayService } from '../runtime/relay/desktop-relay-service'
import type { StarNagService } from '../star-nag/service'
import type { AgentAwakeService } from '../agent-awake-service'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'
import type { AutomationService } from '../automations/service'
import type { PluginService } from '../plugins/plugin-service'
import type { PluginKillListService } from '../plugins/plugin-kill-list-service'
import type { PluginMarketplaceService } from '../plugins/plugin-marketplace-service'
import type { PluginMarketplaceInstaller } from '../plugins/plugin-marketplace-installer'
import type { KeybindingService } from '../keybindings/keybinding-service'
import type { RelayBrokerStatus } from '../runtime/relay/relay-session-broker'
import type { AgentBrowserBridge } from '../browser/agent-browser-bridge'
import type { AgentHookProviderSessionIdentity } from '../agent-hooks/server'
import type { EmulatorBridge } from '../emulator/emulator-bridge'
import type { GpuFallbackMarker, GpuFallbackEnvironment } from './gpu-fallback-marker'
import type { createCodexSessionMigrationScheduler } from '../codex/codex-session-migration-scheduler'
import type { getDevInstanceIdentity } from './dev-instance-identity'
import type { createServeDesktopActivationGate } from './serve-desktop-activation'
import type { ensureActiveMantaProfile } from '../manta-profiles/profile-index-store'
import type { createWindowsShellPathHydration } from './windows-shell-path-hydration'
import type { ServeOptions } from './main-process-serve'
import type { HangDetectionMarker } from '../hang-watchdog/hang-detection-marker'
import { ServeReadinessPublisher } from '../server/serve-readiness'
import { SkillShareDeepLinkState } from './skill-share-deep-link-state'
import {
  DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD,
  DEFAULT_GPU_CRASH_FALLBACK_WINDOW_MS,
  GpuCrashFallbackTracker
} from '../crash-reporting/gpu-crash-fallback-decision'
import type { GpuCrashDiagnosticsRecorder } from '../crash-reporting/gpu-crash-diagnostics'
import { createWebContentsTimedFlag } from './web-contents-timed-flag'

/** Mutable composition-root state shared by startup, window, serve, and quit phases. */
export const mainProcessState = {
  mainWindow: null as BrowserWindow | null,
  isQuitting: false,
  store: null as Store | null,
  stats: null as StatsCollector | null,
  claudeUsage: null as ClaudeUsageStore | null,
  codexUsage: null as CodexUsageStore | null,
  openCodeUsage: null as OpenCodeUsageStore | null,
  codexAccounts: null as CodexAccountService | null,
  codexRuntimeHome: null as CodexRuntimeHomeService | null,
  codexSessionMigration: null as ReturnType<typeof createCodexSessionMigrationScheduler> | null,
  claudeAccounts: null as ClaudeAccountService | null,
  claudeRuntimeAuth: null as ClaudeRuntimeAuthService | null,
  runtime: null as MantaRuntimeService | null,
  rateLimits: null as RateLimitService | null,
  runtimeRpc: null as MantaRuntimeRpcServer | null,
  serveReadinessPublisher: new ServeReadinessPublisher(),
  desktopRelayService: null as DesktopRelayService | null,
  desktopRelayStatus: 'offline' as RelayBrokerStatus,
  pendingUnpairedDeviceAuthFailure: false,
  headlessBrowserDisplayAvailable: false,
  starNag: null as StarNagService | null,
  agentAwakeService: null as AgentAwakeService | null,
  crashReports: null as CrashReportStore | null,
  unsubscribeAgentAwakeStatusChanges: null as (() => void) | null,
  publishProviderSessionChanges: null as
    | ((identities: AgentHookProviderSessionIdentity[]) => void)
    | null,
  unsubscribeSystemResumeBroadcast: null as (() => void) | null,
  watcherShutdownPromise: null as Promise<void> | null,
  watcherShutdownDone: false,
  automations: null as AutomationService | null,
  pluginService: null as PluginService | null,
  pluginKillListService: null as PluginKillListService | null,
  pluginMarketplaceService: null as PluginMarketplaceService | null,
  pluginMarketplaceInstaller: null as PluginMarketplaceInstaller | null,
  keybindings: null as KeybindingService | null,
  expectedRendererReload: createWebContentsTimedFlag(),
  recoveryReloadInFlight: createWebContentsTimedFlag(),
  pendingOpenSettings: createWebContentsTimedFlag(),
  skillShareDeepLinks: new SkillShareDeepLinkState(),
  firstWindowStartupServicesReady: Promise.resolve(),
  managedWslCliReconciliationReady: Promise.resolve(),
  managedWslCliStartupBarrierReady: Promise.resolve(),
  managedWslCliReconciliationStatus: 'settled' as 'pending' | 'settled' | 'failed',
  gpuCrashFallbackTracker: new GpuCrashFallbackTracker({
    windowMs: DEFAULT_GPU_CRASH_FALLBACK_WINDOW_MS,
    threshold: DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD
  }),
  activeGpuFallbackMarker: null as GpuFallbackMarker | null,
  gpuFallbackActiveThisLaunch: false,
  gpuFeatureStatus: null as Electron.GPUFeatureStatus | null,
  gpuCrashDiagnostics: null as GpuCrashDiagnosticsRecorder | null,
  localPtyStartupReady: Promise.resolve(),
  localPtyProviderStartupReady: Promise.resolve(),
  isServeMode: false,
  devInstanceIdentity: null as ReturnType<typeof getDevInstanceIdentity> | null,
  devAgentHookEndpointNamespace: undefined as string | undefined,
  startupDiagnosticsEnabled: false,
  desktopActivationGate: null as ReturnType<typeof createServeDesktopActivationGate> | null,
  activeMantaProfile: null as ReturnType<typeof ensureActiveMantaProfile> | null,
  windowsShellPathHydration: null as ReturnType<typeof createWindowsShellPathHydration> | null,
  shellPathReady: Promise.resolve(),
  hangDetection: null as HangDetectionMarker | null,
  skillTransactionRecovery: Promise.resolve() as Promise<unknown>,
  serveOptions: null as ServeOptions | null,
  desktopWindow: null as BrowserWindow | null,
  agentBrowserBridge: null as AgentBrowserBridge | null,
  emulatorBridge: null as EmulatorBridge | null,
  tray: null as Tray | null
}

/** Environment passed to GPU fallback marker helpers. */
export function gpuFallbackEnvironment(): GpuFallbackEnvironment {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    platform: process.platform
  }
}
