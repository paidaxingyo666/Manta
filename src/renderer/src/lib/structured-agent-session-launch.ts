import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  createStructuredCodexSessionLaunchIntent,
  abandonStructuredAgentSessionLaunchIntent,
  launchStructuredCodexSession,
  StructuredAgentSessionCreateRefusalError,
  type StructuredAgentSessionLaunchIntent
} from '@/lib/launch-structured-codex-session'
import { refreshLocalStructuredSessionTabs } from '@/runtime/local-structured-session-tabs-sync'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'

type StructuredLaunchState = {
  intent: StructuredAgentSessionLaunchIntent
  promise: Promise<string>
  visibilityUnknown: boolean
  cancelled: boolean
  cancelWaiters: Set<() => void>
  lastError: unknown
}

export type StructuredCodexLaunchStatus = 'idle' | 'pending' | 'unknown'

const pendingStructuredLaunchesByWorktree = new Map<string, StructuredLaunchState>()
const structuredLaunchListeners = new Set<() => void>()

function notifyStructuredLaunchListeners(): void {
  for (const listener of structuredLaunchListeners) {
    listener()
  }
}

export function subscribeStructuredCodexLaunchStatus(listener: () => void): () => void {
  structuredLaunchListeners.add(listener)
  return () => structuredLaunchListeners.delete(listener)
}

export function getStructuredCodexLaunchStatus(worktreeId: string): StructuredCodexLaunchStatus {
  const state = pendingStructuredLaunchesByWorktree.get(worktreeId)
  if (!state) {
    return 'idle'
  }
  return state.visibilityUnknown ? 'unknown' : 'pending'
}

export function useStructuredCodexLaunchStatus(worktreeId: string): StructuredCodexLaunchStatus {
  return useSyncExternalStore(
    subscribeStructuredCodexLaunchStatus,
    () => getStructuredCodexLaunchStatus(worktreeId),
    () => 'idle'
  )
}

class StructuredAgentSessionLaunchCancelledError extends Error {
  constructor() {
    super('structured session launch cancelled')
    this.name = 'StructuredAgentSessionLaunchCancelledError'
  }
}

function throwIfLaunchCancelled(state: StructuredLaunchState): void {
  if (state.cancelled) {
    throw new StructuredAgentSessionLaunchCancelledError()
  }
}

function trackLaunchSettlement(
  worktreeId: string,
  state: StructuredLaunchState,
  promise: Promise<string>
): void {
  void promise.then(
    () => {
      if (
        state.promise === promise &&
        pendingStructuredLaunchesByWorktree.get(worktreeId) === state
      ) {
        pendingStructuredLaunchesByWorktree.delete(worktreeId)
        notifyStructuredLaunchListeners()
      }
    },
    () => {
      if (
        state.promise === promise &&
        !state.visibilityUnknown &&
        pendingStructuredLaunchesByWorktree.get(worktreeId) === state
      ) {
        pendingStructuredLaunchesByWorktree.delete(worktreeId)
        notifyStructuredLaunchListeners()
      }
    }
  )
}

function hasAdoptedStructuredSession(intent: StructuredAgentSessionLaunchIntent): boolean {
  return Boolean(
    useAppStore
      .getState()
      .unifiedTabsByWorktree[intent.worktreeId]?.some(
        (tab) =>
          tab.contentType === 'agent-session' &&
          tab.entityId === intent.sessionId &&
          tab.worktreeId === intent.worktreeId
      )
  )
}

/** Wait for the host-emitted projection; this is the normal launch completion path. */
function waitForStructuredSessionAdoption(
  state: StructuredLaunchState,
  timeoutMs = 3000
): Promise<string> {
  if (hasAdoptedStructuredSession(state.intent)) {
    return Promise.resolve(state.intent.sessionId)
  }
  // Keep unit-test and degraded harnesses deterministic when no store API is installed.
  if (typeof useAppStore.subscribe !== 'function') {
    return Promise.reject(new Error('structured session tab adoption unavailable'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      unsubscribe()
      clearTimeout(timeout)
      state.cancelWaiters.delete(cancel)
      if (error) {
        reject(error)
      } else {
        resolve(state.intent.sessionId)
      }
    }
    const cancel = (): void => finish(new StructuredAgentSessionLaunchCancelledError())
    const unsubscribe = useAppStore.subscribe((nextState) => {
      if (
        nextState.unifiedTabsByWorktree[state.intent.worktreeId]?.some(
          (tab) =>
            tab.contentType === 'agent-session' &&
            tab.entityId === state.intent.sessionId &&
            tab.worktreeId === state.intent.worktreeId
        )
      ) {
        finish()
      }
    })
    const timeout = setTimeout(
      () => finish(new Error('structured session tab adoption timed out')),
      timeoutMs
    )
    state.cancelWaiters.add(cancel)
    if (state.cancelled) {
      cancel()
    }
  })
}

async function recoverStructuredSessionFromInventory(
  state: StructuredLaunchState,
  priorError: unknown
): Promise<string> {
  state.lastError = priorError
  throwIfLaunchCancelled(state)
  try {
    const snapshots = await refreshLocalStructuredSessionTabs()
    throwIfLaunchCancelled(state)
    const published = inventoryContainsIntent(snapshots, state.intent)
    if (published && hasAdoptedStructuredSession(state.intent)) {
      return state.intent.sessionId
    }
  } catch (error) {
    if (error instanceof StructuredAgentSessionLaunchCancelledError) {
      throw error
    }
  }
  state.visibilityUnknown = true
  notifyStructuredLaunchListeners()
  throw priorError instanceof Error ? priorError : new Error(String(priorError))
}

function inventoryContainsIntent(
  snapshots: readonly RuntimeMobileSessionTabsResult[],
  intent: StructuredAgentSessionLaunchIntent
): boolean {
  return snapshots.some(
    (snapshot) =>
      snapshot.worktree === intent.worktreeId &&
      snapshot.tabs.some(
        (tab) => tab.type === 'agent-session' && tab.sessionId === intent.sessionId
      )
  )
}

async function reconcileUnknownLaunch(state: StructuredLaunchState): Promise<string> {
  throwIfLaunchCancelled(state)
  state.visibilityUnknown = false
  notifyStructuredLaunchListeners()
  try {
    return await waitForStructuredSessionAdoption(state, 1000)
  } catch (error) {
    if (error instanceof StructuredAgentSessionLaunchCancelledError) {
      throw error
    }
    try {
      const snapshots = await refreshLocalStructuredSessionTabs()
      if (inventoryContainsIntent(snapshots, state.intent)) {
        return await waitForStructuredSessionAdoption(state, 1000)
      }
      await launchStructuredCodexSession(state.intent)
      return await waitForStructuredSessionAdoption(state)
    } catch (retryError) {
      if (retryError instanceof StructuredAgentSessionLaunchCancelledError) {
        throw retryError
      }
      if (retryError instanceof StructuredAgentSessionCreateRefusalError) {
        throw retryError
      }
      return recoverStructuredSessionFromInventory(
        state,
        state.lastError instanceof Error ? state.lastError : retryError
      )
    }
  }
}

async function launchAndReconcile(state: StructuredLaunchState): Promise<string> {
  throwIfLaunchCancelled(state)
  try {
    await launchStructuredCodexSession(state.intent)
  } catch (error) {
    if (state.cancelled) {
      throw new StructuredAgentSessionLaunchCancelledError()
    }
    if (error instanceof StructuredAgentSessionCreateRefusalError) {
      throw error
    }
    try {
      return await waitForStructuredSessionAdoption(state)
    } catch (adoptionError) {
      if (adoptionError instanceof StructuredAgentSessionLaunchCancelledError) {
        throw adoptionError
      }
      return recoverStructuredSessionFromInventory(state, error)
    }
  }
  try {
    throwIfLaunchCancelled(state)
    return await waitForStructuredSessionAdoption(state)
  } catch (error) {
    if (error instanceof StructuredAgentSessionLaunchCancelledError) {
      throw error
    }
    return recoverStructuredSessionFromInventory(state, error)
  }
}

function launchStructuredCodexSessionOnce(worktreeId: string): Promise<string> {
  const existing = pendingStructuredLaunchesByWorktree.get(worktreeId)
  if (existing) {
    if (existing.visibilityUnknown) {
      existing.promise = reconcileUnknownLaunch(existing)
      trackLaunchSettlement(worktreeId, existing, existing.promise)
    }
    return existing.promise
  }
  const state: StructuredLaunchState = {
    intent: createStructuredCodexSessionLaunchIntent(worktreeId),
    promise: Promise.resolve(''),
    visibilityUnknown: false,
    cancelled: false,
    cancelWaiters: new Set(),
    lastError: null
  }
  state.promise = launchAndReconcile(state)
  pendingStructuredLaunchesByWorktree.set(worktreeId, state)
  notifyStructuredLaunchListeners()
  trackLaunchSettlement(worktreeId, state, state.promise)
  return state.promise
}

/** Stop retries for a launch whose tab the user explicitly closed. */
export function cancelStructuredCodexLaunch(worktreeId: string, sessionId: string): boolean {
  const state = pendingStructuredLaunchesByWorktree.get(worktreeId)
  if (!state || state.intent.sessionId !== sessionId) {
    return false
  }
  state.cancelled = true
  for (const cancel of state.cancelWaiters) {
    cancel()
  }
  state.cancelWaiters.clear()
  pendingStructuredLaunchesByWorktree.delete(worktreeId)
  notifyStructuredLaunchListeners()
  abandonStructuredAgentSessionLaunchIntent(state.intent)
  return true
}

export function startStructuredCodexLaunch(worktreeId: string): void {
  void launchStructuredCodexSessionOnce(worktreeId).catch((error) => {
    if (error instanceof StructuredAgentSessionLaunchCancelledError) {
      return
    }
    toast.error(
      translate(
        'components.native-chat.structuredSessionLaunchFailed',
        'Could not open Codex chat'
      ),
      { description: error instanceof Error ? error.message : String(error) }
    )
  })
}
