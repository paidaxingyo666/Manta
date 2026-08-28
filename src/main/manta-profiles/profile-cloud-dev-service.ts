import type {
  CreateCloudLinkedMantaProfileArgs,
  MantaProfileListState
} from '../../shared/manta-profiles'
import type { ActiveMantaProfileState } from './profile-index-store'
import { createCloudLinkedMantaProfileRecord, linkMantaProfileToCloud } from './profile-cloud-index'
import { readMantaCloudSession, saveMantaCloudSessionExchange } from './profile-cloud-session-store'
import { createDevMantaCloudSession } from './profile-cloud-dev-auth'

type DevProfileListResult = MantaProfileListState

type DevCreateProfileResult =
  | {
      status: 'created'
      list: ReturnType<typeof createCloudLinkedMantaProfileRecord>
    }
  | { status: 'reconnect-required' }

type DevMutationResult =
  | {
      status: 'updated'
      list: DevProfileListResult
    }
  | { status: 'reconnect-required' }

export function connectDevMantaCloudProfile(
  active: ActiveMantaProfileState,
  userDataPath: string
): DevProfileListResult {
  const session = createDevMantaCloudSession({ localProfileId: active.profile.id })
  saveMantaCloudSessionExchange(active.profile.id, userDataPath, session)
  return linkMantaProfileToCloud(active.profile.id, session.cloud, userDataPath)
}

export function createDevCloudLinkedMantaProfile(
  active: ActiveMantaProfileState,
  userDataPath: string,
  args: CreateCloudLinkedMantaProfileArgs
): DevCreateProfileResult {
  if (readMantaCloudSession(active.profile.id, userDataPath).status !== 'found') {
    return { status: 'reconnect-required' }
  }
  const session = createDevMantaCloudSession({ orgId: args.orgId })
  const list = createCloudLinkedMantaProfileRecord(session.cloud, { name: args.name }, userDataPath)
  saveMantaCloudSessionExchange(list.profile.id, userDataPath, session)
  return { status: 'created', list }
}

export function refreshDevMantaCloudProfile(
  active: ActiveMantaProfileState,
  userDataPath: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readMantaCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevMantaCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId: active.profile.cloud.activeOrgId
  })
  saveMantaCloudSessionExchange(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkMantaProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}

export function selectDevMantaCloudOrg(
  active: ActiveMantaProfileState,
  userDataPath: string,
  orgId: string
): DevMutationResult {
  if (
    !active.profile.cloud ||
    readMantaCloudSession(active.profile.id, userDataPath).status !== 'found'
  ) {
    return { status: 'reconnect-required' }
  }
  const session = createDevMantaCloudSession({
    localProfileId: active.profile.id,
    cloudProfileId: active.profile.cloud.cloudProfileId,
    orgId
  })
  saveMantaCloudSessionExchange(active.profile.id, userDataPath, session)
  return {
    status: 'updated',
    list: linkMantaProfileToCloud(active.profile.id, session.cloud, userDataPath)
  }
}
