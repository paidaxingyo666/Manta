import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { SshConnectionManager } from '../ssh/ssh-connection-manager'
import type { SshPortForwardManager } from '../ssh/ssh-port-forward'
import type { MantaRuntimeService } from '../runtime/manta-runtime'

// Why live bindings rather than getters: every SSH IPC module reads these singletons on the hot
// path, and only registerSshHandlers/the test reset write them (through the setters below).
export let connectionManager: SshConnectionManager | null = null
export let portForwardManager: SshPortForwardManager | null = null
export let persistedStore: Store | null = null
let currentGetMainWindow: () => BrowserWindow | null = () => null
export let currentRuntime: MantaRuntimeService | undefined

export function setConnectionManager(next: SshConnectionManager | null): void {
  connectionManager = next
}

export function setPortForwardManager(next: SshPortForwardManager | null): void {
  portForwardManager = next
}

export function setPersistedStore(next: Store | null): void {
  persistedStore = next
}

export function setCurrentGetMainWindow(next: () => BrowserWindow | null): void {
  currentGetMainWindow = next
}

export function setCurrentRuntime(next: MantaRuntimeService | undefined): void {
  currentRuntime = next
}

export function getCurrentMainWindow(): BrowserWindow | null {
  return currentGetMainWindow()
}
