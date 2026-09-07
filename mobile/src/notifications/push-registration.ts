import {
  saveNotificationDeliveryPreferences,
  type NotificationDeliveryPreferences
} from './notification-delivery-preferences'
import type {
  MobilePushRegisterInput,
  MobilePushRegisterResult
} from '../../../src/shared/mobile-push-contract'
import { NOTIFICATIONS_REMOTE_PUSH_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'
import type { RpcClient } from '../transport/rpc-client'
import {
  loadRemotePushEnabled,
  loadRemotePushFilter,
  loadRemotePushHostRegistrations,
  saveRemotePushAgentStates,
  saveRemotePushEnabled,
  saveRemotePushHostRegistrations,
  type RemotePushAgentState,
  type RemotePushFilter
} from '../storage/preferences'
import { addPushTokenListener, getDevicePushToken, type MobilePushToken } from './push-token'

export const NOTIFICATIONS_REMOTE_PUSH_CAPABILITY = NOTIFICATIONS_REMOTE_PUSH_RUNTIME_CAPABILITY

type PushClient = Pick<RpcClient, 'sendRequest'>

const REQUEST_TIMEOUT_MS = 5_000
const REMOVAL_TIMEOUT_MS = 2_000

type HostPushState = {
  client: PushClient | null
  // An unanswered probe is unknown, not unsupported.
  supported: boolean | null
  chain: Promise<void>
}

type RegistrationRecords = { registered: Set<string>; pending: Set<string> }

const hostsById = new Map<string, HostPushState>()
let registrationRecords: RegistrationRecords | null = null
let tokenPromise: Promise<MobilePushToken | null> | null = null
// A late registration must not overwrite a newer preference or consent choice.
let consentGeneration = 0

function hostState(hostId: string): HostPushState {
  let state = hostsById.get(hostId)
  if (!state) {
    state = { client: null, supported: null, chain: Promise.resolve() }
    hostsById.set(hostId, state)
  }
  return state
}

async function readRecords(): Promise<RegistrationRecords> {
  if (!registrationRecords) {
    const stored = await loadRemotePushHostRegistrations()
    registrationRecords ??= {
      registered: new Set(stored.registeredHostIds),
      pending: new Set(stored.pendingUnregisterHostIds)
    }
  }
  return registrationRecords
}

async function mutateRecords(mutate: (value: RegistrationRecords) => void): Promise<void> {
  const value = await readRecords()
  mutate(value)
  await saveRemotePushHostRegistrations({
    registeredHostIds: [...value.registered],
    pendingUnregisterHostIds: [...value.pending]
  }).catch(() => {})
}

// A missing token is retried: APNs registration may still be in flight.
async function currentToken(): Promise<MobilePushToken | null> {
  if (!tokenPromise) {
    const pending: Promise<MobilePushToken | null> = getDevicePushToken().then((token) => {
      if (!token && tokenPromise === pending) {
        tokenPromise = null
      }
      return token
    })
    tokenPromise = pending
  }
  return tokenPromise
}

async function readRemotePushCapability(client: PushClient): Promise<boolean | null> {
  try {
    const response = await client.sendRequest('status.get')
    if (!response.ok) {
      return null
    }
    const result = response.result
    if (!result || typeof result !== 'object') {
      return false
    }
    const capabilities = (result as { capabilities?: unknown }).capabilities
    return (
      Array.isArray(capabilities) && capabilities.includes(NOTIFICATIONS_REMOTE_PUSH_CAPABILITY)
    )
  } catch {
    return null
  }
}

async function sendRegister(
  client: PushClient,
  token: MobilePushToken,
  filter: RemotePushFilter
): Promise<boolean> {
  const params: Omit<MobilePushRegisterInput, 'deviceId'> = {
    platform: token.platform,
    token: token.token,
    ...(token.apnsEnvironment ? { apnsEnvironment: token.apnsEnvironment } : {}),
    filter: { ...filter, sources: [...filter.sources], agentStates: [...filter.agentStates] }
  }
  const response = await client
    .sendRequest('notifications.registerPush', params, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      failWhenDisconnected: true
    })
    .catch(() => null)
  if (!response?.ok) {
    return false
  }
  return (response.result as MobilePushRegisterResult | null)?.registered === true
}

async function sendUnregister(client: PushClient, timeoutMs: number): Promise<boolean> {
  const response = await client
    .sendRequest('notifications.unregisterPush', null, {
      timeoutMs,
      failWhenDisconnected: true
    })
    .catch(() => null)
  return response?.ok === true
}

async function reconcileHost(hostId: string): Promise<void> {
  const state = hostsById.get(hostId)
  const client = state?.client
  if (!state || !client) {
    return
  }
  const generation = consentGeneration
  const value = await readRecords()
  // Unregister intent takes priority even before the capability probe answers.
  if (value.pending.has(hostId)) {
    if (state.supported === false || !(await sendUnregister(client, REQUEST_TIMEOUT_MS))) {
      return
    }
    await mutateRecords((current) => {
      current.pending.delete(hostId)
      current.registered.delete(hostId)
    })
    // A preference change can invalidate a register without disabling push.
    if (!(await loadRemotePushEnabled())) {
      return
    }
  }
  if (state.supported == null) {
    const probed = await readRemotePushCapability(client)
    if (state.client !== client) {
      return
    }
    if (probed == null) {
      return
    }
    state.supported = probed
  }
  if (!state.supported || state.client !== client) {
    return
  }
  if (!(await loadRemotePushEnabled())) {
    return
  }
  const token = await currentToken()
  if (!token) {
    return
  }
  if (!(await sendRegister(client, token, await loadRemotePushFilter()))) {
    return
  }
  if (generation !== consentGeneration) {
    await mutateRecords((current) => current.pending.add(hostId))
    void enqueueReconcile(hostId)
    return
  }
  await mutateRecords((current) => current.registered.add(hostId))
}

function enqueueReconcile(hostId: string): Promise<void> {
  const state = hostState(hostId)
  const run = state.chain.then(() => reconcileHost(hostId)).catch(() => {})
  state.chain = run
  return run
}

async function reconcileAllHosts(): Promise<void> {
  await Promise.all([...hostsById.keys()].map((hostId) => enqueueReconcile(hostId)))
}

/**
 * Track a host whose client has reached `connected`, registering (or retrying a
 * pending unregister) as the current preference requires. The returned function
 * detaches the client on disconnect; the host's tracked state survives it.
 */
export function attachPushRegistration(hostId: string, client: PushClient): () => void {
  const state = hostState(hostId)
  if (state.client !== client) {
    state.client = client
    state.supported = null
  }
  void enqueueReconcile(hostId)
  return () => {
    if (state.client === client) {
      state.client = null
    }
  }
}

export async function setRemotePushEnabled(enabled: boolean): Promise<void> {
  consentGeneration++
  await saveRemotePushEnabled(enabled)
  await mutateRecords((current) => {
    if (!enabled) {
      for (const hostId of current.registered) {
        current.pending.add(hostId)
      }
      return
    }
    current.pending.clear()
  })
  await reconcileAllHosts()
}

export async function setNotificationDeliveryPreferences(
  value: NotificationDeliveryPreferences
): Promise<void> {
  consentGeneration++
  await saveNotificationDeliveryPreferences(value)
  await reconcileAllHosts()
}

/** Re-registers every connected host so the gateway stores the narrowed filter. */
export async function setRemotePushAgentStates(
  states: readonly RemotePushAgentState[]
): Promise<void> {
  consentGeneration++
  await saveRemotePushAgentStates(states)
  await reconcileAllHosts()
}

/**
 * Best-effort unregister before the host's credentials are deleted.
 *
 * Why best-effort is all there is: the credentials are the only way back to that
 * host, so a desktop that was offline here keeps its gateway registration and keeps
 * pushing to this phone. shouldSuppressForegroundPush drops those in the foreground;
 * background alerts stop only when that desktop unpairs the phone, or the switch is
 * turned off here. Documented in docs/site/content/docs/notifications.mdx.
 */
export async function unregisterPushForRemovedHost(hostId: string): Promise<void> {
  const state = hostsById.get(hostId)
  if (state?.client && state.supported !== false) {
    await sendUnregister(state.client, REMOVAL_TIMEOUT_MS)
  }
  hostsById.delete(hostId)
  await mutateRecords((current) => {
    current.registered.delete(hostId)
    current.pending.delete(hostId)
  })
}

/** A rolled token stops delivering, so re-register every connected host at once. */
export function startPushTokenSync(): () => void {
  return addPushTokenListener((token) => {
    tokenPromise = Promise.resolve(token)
    void reconcileAllHosts()
  })
}

export function resetPushRegistrationForTests(): void {
  hostsById.clear()
  registrationRecords = null
  tokenPromise = null
  consentGeneration = 0
}
