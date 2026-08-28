import type { RefreshCurrentMantaProfileAuthResult } from '../../shared/manta-profiles'
import { getMantaCloudAuthConfig, isMantaCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { getMantaProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { refreshMantaCloudCapabilities } from './profile-cloud-client'
import { linkMantaProfileToCloud } from './profile-cloud-index'
import { ensureActiveMantaProfile, getMantaProfileListState } from './profile-index-store'
import { refreshDevMantaCloudProfile } from './profile-cloud-dev-service'
import {
  captureCloudSessionMutation,
  cloudSessionIdentity,
  recordCloudSessionIdentityMutationIfCurrent
} from './profile-cloud-session-mutation'
import { runWithFreshMantaCloudSession } from './profile-cloud-session-refresh'
import { readMantaCloudSession, saveMantaCloudSessionIfCurrent } from './profile-cloud-session-store'

export async function refreshCurrentMantaProfileAuth(
  userDataPath: string
): Promise<RefreshCurrentMantaProfileAuthResult> {
  const active = ensureActiveMantaProfile(userDataPath)
  const auth = () => getMantaProfileAuthStatusFromProfile(active, userDataPath)
  if (!active.profile.cloud) {
    return { status: 'local', auth: auth() }
  }
  if (isMantaCloudDevAuthEnabled()) {
    const result = refreshDevMantaCloudProfile(active, userDataPath)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: auth(),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }
  const configState = getMantaCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: auth() }
  }
  try {
    const identity = cloudSessionIdentity(active.profile.id, active.profile.cloud)
    let mutationSnapshot = captureCloudSessionMutation(identity, userDataPath)
    const operation = await runWithFreshMantaCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => refreshMantaCloudCapabilities(configState.config, session)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: auth() }
    }
    const refresh = operation.value
    if (refresh.cloud) {
      const refreshedIdentity = cloudSessionIdentity(active.profile.id, refresh.cloud)
      if (
        refreshedIdentity.cloudUserId !== identity.cloudUserId ||
        refreshedIdentity.cloudProfileId !== identity.cloudProfileId
      ) {
        throw new Error('manta_cloud_identity_changed_during_capability_refresh')
      }
      if (refreshedIdentity.organizationId !== identity.organizationId) {
        const advanced = recordCloudSessionIdentityMutationIfCurrent(
          refreshedIdentity,
          userDataPath,
          mutationSnapshot
        )
        if (!advanced) {
          return { status: 'reconnect-required', auth: auth() }
        }
        mutationSnapshot = advanced
      }
    }
    const session = readMantaCloudSession(active.profile.id, userDataPath)
    if (session.status !== 'found') {
      return { status: 'reconnect-required', auth: auth() }
    }
    if (
      saveMantaCloudSessionIfCurrent(
        active.profile.id,
        userDataPath,
        {
          ...session.session,
          organizations: refresh.organizations ?? session.session.organizations,
          capabilities: refresh.capabilities
        },
        mutationSnapshot
      ) === null
    ) {
      return { status: 'reconnect-required', auth: auth() }
    }
    const list = refresh.cloud
      ? linkMantaProfileToCloud(active.profile.id, refresh.cloud, userDataPath)
      : getMantaProfileListState(userDataPath)
    return {
      status: 'refreshed',
      auth: getMantaProfileAuthStatusFromProfile(
        ensureActiveMantaProfile(userDataPath),
        userDataPath
      ),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: auth(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
