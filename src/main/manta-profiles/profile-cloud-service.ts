import type {
  ConnectCurrentMantaProfileResult,
  CreateCloudLinkedMantaProfileArgs,
  CreateCloudLinkedMantaProfileResult,
  MantaProfileAuthStatus,
  SelectMantaProfileOrgResult,
  SignOutCurrentMantaProfileResult
} from '../../shared/manta-profiles'
import type { ConnectCurrentMantaProfileArgs } from '../../shared/manta-cloud-credentials'
import { ensureActiveMantaProfile } from './profile-index-store'
import { getMantaCloudAuthConfig, isMantaCloudDevAuthEnabled } from './profile-cloud-auth-config'
import {
  clearMantaCloudSession,
  readMantaCloudSession,
  saveMantaCloudSessionExchange
} from './profile-cloud-session-store'
import { cloudSessionIdentity, tombstoneCloudSession } from './profile-cloud-session-mutation'
import {
  createMantaCloudProfile,
  exchangeMantaCloudAuthCode,
  grantMantaCloudSessionDirectly,
  MantaCloudRequestError,
  revokeMantaCloudSession
} from './profile-cloud-client'
import { beginMantaCloudPkceFlow } from './profile-cloud-pkce'
import {
  exchangeMantaCloudCredentials,
  MantaCloudCredentialError
} from './profile-cloud-credential-connect'
import {
  createCloudLinkedMantaProfileRecord,
  linkMantaProfileToCloud,
  unlinkMantaProfileFromCloud
} from './profile-cloud-index'
import { runWithFreshMantaCloudSession } from './profile-cloud-session-refresh'
import {
  connectDevMantaCloudProfile,
  createDevCloudLinkedMantaProfile,
  selectDevMantaCloudOrg
} from './profile-cloud-dev-service'
import { getMantaProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { selectCloudOrgWithMutationFence } from './profile-cloud-org-selection'

export { refreshCurrentMantaProfileAuth } from './profile-cloud-capability-refresh'

function isUserCancelledAuthError(message: string): boolean {
  return message === 'manta_cloud_auth_timeout' || message === 'manta_cloud_auth_denied'
}

function activeAuth(
  active: ReturnType<typeof ensureActiveMantaProfile>,
  userDataPath: string
): MantaProfileAuthStatus {
  return getMantaProfileAuthStatusFromProfile(active, userDataPath)
}

export function getCurrentMantaProfileAuthStatus(userDataPath: string): MantaProfileAuthStatus {
  return getMantaProfileAuthStatusFromProfile(ensureActiveMantaProfile(userDataPath), userDataPath)
}

export async function connectCurrentMantaProfile(
  userDataPath: string,
  args?: ConnectCurrentMantaProfileArgs
): Promise<ConnectCurrentMantaProfileResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  // Credentials bypass the dev shortcut deliberately: a user who typed an
  // address and a password is asking to reach a real relay, not a stub.
  if (isMantaCloudDevAuthEnabled() && !args?.credentials) {
    const list = connectDevMantaCloudProfile(active, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  }

  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: activeAuth(active, userDataPath)
    }
  }

  try {
    // Three ways in, in order of specificity: an account the user named, the
    // deployment-wide enrolment secret, and finally the browser code flow.
    const exchange = args?.credentials
      ? await exchangeMantaCloudCredentials(configState.config, args.credentials)
      : configState.config.enrollmentSecret
        ? await grantMantaCloudSessionDirectly(configState.config, active.profile.id)
        : await exchangeMantaCloudAuthCode(configState.config, {
            ...(await beginMantaCloudPkceFlow(configState.config, active.profile.id)),
            localProfileId: active.profile.id
          })
    saveMantaCloudSessionExchange(active.profile.id, userDataPath, exchange)
    const list = linkMantaProfileToCloud(active.profile.id, exchange.cloud, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isUserCancelledAuthError(message)) {
      return {
        status: 'cancelled',
        auth: getCurrentMantaProfileAuthStatus(userDataPath)
      }
    }
    const errorCode =
      error instanceof MantaCloudCredentialError || error instanceof MantaCloudRequestError
        ? error.errorCode
        : undefined
    return {
      status: 'failed',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      // Every surface that offers "sign in" with no form ends up here, and
      // 'manta_cloud_request_failed_409' names nothing a person can act on.
      error:
        errorCode === 'accounts_required'
          ? 'This relay gives each person their own account. Sign in from Settings → Manta Account.'
          : message,
      ...(errorCode ? { errorCode } : {})
    }
  }
}

export async function signOutCurrentMantaProfile(
  userDataPath: string
): Promise<SignOutCurrentMantaProfileResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  const configState = getMantaCloudAuthConfig()
  const session = readMantaCloudSession(active.profile.id, userDataPath)
  if (active.profile.cloud) {
    // Why: persist the destructive fence before logout network I/O so a
    // refresh already in flight cannot save after explicit sign-out.
    tombstoneCloudSession(
      cloudSessionIdentity(active.profile.id, active.profile.cloud),
      userDataPath
    )
  }
  if (!isMantaCloudDevAuthEnabled() && configState.configured && session.status === 'found') {
    await revokeMantaCloudSession(configState.config, session.session).catch(() => undefined)
  }
  clearMantaCloudSession(active.profile.id, userDataPath)
  const list = unlinkMantaProfileFromCloud(active.profile.id, userDataPath)
  return {
    status: 'signed-out',
    auth: getCurrentMantaProfileAuthStatus(userDataPath),
    activeProfileId: list.activeProfileId,
    profiles: list.profiles
  }
}

export async function createCloudLinkedMantaProfile(
  userDataPath: string,
  args: CreateCloudLinkedMantaProfileArgs
): Promise<CreateCloudLinkedMantaProfileResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  if (isMantaCloudDevAuthEnabled()) {
    const result = createDevCloudLinkedMantaProfile(active, userDataPath, args)
    if (result.status !== 'created') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'created',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles,
      profile: result.list.profile
    }
  }

  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const operation = await runWithFreshMantaCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => createMantaCloudProfile(configState.config, session, args)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    const created = operation.value
    const list = createCloudLinkedMantaProfileRecord(
      created.cloud,
      { name: args.name },
      userDataPath
    )
    saveMantaCloudSessionExchange(list.profile.id, userDataPath, created)
    return {
      status: 'created',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles,
      profile: list.profile
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function selectCurrentMantaProfileOrg(
  userDataPath: string,
  orgId: string
): Promise<SelectMantaProfileOrgResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  if (isMantaCloudDevAuthEnabled()) {
    const result = selectDevMantaCloudOrg(active, userDataPath, orgId)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }

  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const list = await selectCloudOrgWithMutationFence({
      config: configState.config,
      active,
      userDataPath,
      orgId
    })
    if (!list) {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentMantaProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
