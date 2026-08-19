import { MANTA_BROWSER_PARTITION } from './constants'
import type { ExecutionHostId } from './execution-host'

export const MANTA_PROFILE_INDEX_SCHEMA_VERSION = 1
export const DEFAULT_LOCAL_MANTA_PROFILE_ID = 'local-default'
export const DEFAULT_LOCAL_MANTA_PROFILE_NAME = 'Personal'
const LEGACY_MANTA_BROWSER_SESSION_PARTITION_PREFIX = 'persist:manta-browser-session-'

export type MantaProfileAvatar = {
  kind: 'initials'
  initials: string
  color: 'neutral'
}

export type MantaProfileKind = 'local' | 'cloud-linked'

export type MantaProfileCloudSummary = {
  cloudProfileId: string
  userId: string
  email: string
  displayName?: string
  activeOrgId?: string
  activeOrgName?: string
  linkedAt: number
}

export type MantaCloudOrgSummary = {
  orgId: string
  name: string
  role?: string
}

export type MantaCloudCapabilityFlags = Record<string, boolean>

export type MantaCloudCapabilities = {
  flags: MantaCloudCapabilityFlags
  refreshedAt: number
}

export type MantaCloudSessionPersistence = 'none' | 'encrypted' | 'memory-only' | 'dev-plaintext'

export type MantaProfileAuthState = 'local' | 'unconfigured' | 'connected' | 'reconnect-required'

export type MantaProfileAuthStatus = {
  activeProfileId: string
  configured: boolean
  state: MantaProfileAuthState
  persistence: MantaCloudSessionPersistence
  cloud?: MantaProfileCloudSummary
  organizations?: MantaCloudOrgSummary[]
  capabilities?: MantaCloudCapabilities
  credentialError?: string
  setupMessage?: string
}

export type MantaProfileSummary = {
  id: string
  name: string
  avatar: MantaProfileAvatar
  kind: MantaProfileKind
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  cloud?: MantaProfileCloudSummary
}

export type MantaProfileIndex = {
  schemaVersion: number
  activeProfileId: string
  profiles: MantaProfileSummary[]
}

export type MantaProfileListState = {
  activeProfileId: string
  profiles: MantaProfileSummary[]
}

export type MantaProfileListResult = MantaProfileListState & {
  // Why: gates the full multi-profile switcher UI; default builds show a
  // single-profile account menu instead.
  multiProfileUi: boolean
}

export type CreateLocalMantaProfileArgs = {
  name?: string
}

export type CreateLocalMantaProfileResult = MantaProfileListState & {
  profile: MantaProfileSummary
}

export type CreateCloudLinkedMantaProfileArgs = {
  orgId?: string
  name?: string
}

export type SwitchMantaProfileArgs = {
  profileId: string
}

export type SwitchMantaProfileResult = {
  status: 'already-active' | 'relaunching'
}

export type TransferMantaProfileProjectMode = 'move' | 'copy'

export type TransferMantaProfileProjectArgs = {
  sourceProfileId: string
  targetProfileId: string
  repoId: string
  mode: TransferMantaProfileProjectMode
}

export type FindMantaProfileProjectsByPathArgs = {
  path: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  excludeProfileId?: string | null
}

export type MantaProfileProjectPresence = {
  profileId: string
  profileName: string
  profileKind: MantaProfileKind
  repoId: string
  repoName: string
}

export type FindMantaProfileProjectsByPathResult = {
  projects: MantaProfileProjectPresence[]
}

export type TransferMantaProfileProjectResult =
  | {
      status: 'transferred'
      mode: TransferMantaProfileProjectMode
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      targetRepoId: string
      targetProjectId: string | null
      willRelaunch?: boolean
    }
  | {
      status: 'duplicate-target'
      sourceProfileId: string
      targetProfileId: string
      sourceRepoId: string
      duplicateRepoId: string
    }

export type ConnectCurrentMantaProfileResult =
  | {
      status: 'connected'
      auth: MantaProfileAuthStatus
      activeProfileId: string
      profiles: MantaProfileSummary[]
    }
  | {
      status: 'unconfigured'
      auth: MantaProfileAuthStatus
    }
  | {
      status: 'cancelled'
      auth: MantaProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: MantaProfileAuthStatus
      error: string
    }

export type CreateCloudLinkedMantaProfileResult =
  | {
      status: 'created'
      auth: MantaProfileAuthStatus
      activeProfileId: string
      profiles: MantaProfileSummary[]
      profile: MantaProfileSummary
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: MantaProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: MantaProfileAuthStatus
      error: string
    }

export type SignOutCurrentMantaProfileResult = {
  status: 'signed-out'
  auth: MantaProfileAuthStatus
  activeProfileId: string
  profiles: MantaProfileSummary[]
}

export type SelectMantaProfileOrgArgs = {
  orgId: string
}

export type SelectMantaProfileOrgResult =
  | {
      status: 'selected'
      auth: MantaProfileAuthStatus
      activeProfileId: string
      profiles: MantaProfileSummary[]
    }
  | {
      status: 'unconfigured' | 'reconnect-required'
      auth: MantaProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: MantaProfileAuthStatus
      error: string
    }

export type RefreshCurrentMantaProfileAuthResult =
  | {
      status: 'refreshed'
      auth: MantaProfileAuthStatus
      activeProfileId: string
      profiles: MantaProfileSummary[]
    }
  | {
      status: 'local' | 'unconfigured' | 'reconnect-required'
      auth: MantaProfileAuthStatus
    }
  | {
      status: 'failed'
      auth: MantaProfileAuthStatus
      error: string
    }

// Why: organization roles are a fixed server-side enum; the desktop UI mirrors
// exactly these three so role selects can't drift from what the API accepts.
export type MantaOrgRole = 'owner' | 'admin' | 'member'

export type MantaOrgMember = {
  // Why: null for teammates provisioned server-side who never signed into Manta;
  // mutation actions are disabled for them since the API keys on a real userId.
  userId: string | null
  email: string
  displayName?: string
  role: MantaOrgRole
}

export type MantaOrgPendingInvite = {
  email: string
  role: MantaOrgRole
  createdAt: number
}

export type MantaOrgMembersRoster = {
  members: MantaOrgMember[]
  pendingInvites: MantaOrgPendingInvite[]
  viewerRole: MantaOrgRole
  canManageMembers: boolean
}

export type MantaProfileOrgMembersListArgs = {
  orgId: string
}

export type MantaProfileOrgMemberInviteArgs = {
  orgId: string
  email: string
  role: MantaOrgRole
}

export type MantaProfileOrgInviteRevokeArgs = {
  orgId: string
  email: string
}

export type MantaProfileOrgMemberChangeRoleArgs = {
  orgId: string
  userId: string
  role: MantaOrgRole
}

export type MantaProfileOrgMemberRemoveArgs = {
  orgId: string
  userId: string
}

export type MantaProfileOrgMembersListResult =
  | { status: 'ok'; roster: MantaOrgMembersRoster }
  | { status: 'unconfigured' | 'reconnect-required' }
  | { status: 'failed'; error: string }

export type MantaOrgInviteConflictReason = 'already_member' | 'already_invited'
export type MantaOrgMutationInvalidReason = 'cannot_change_own_role' | 'cannot_remove_self'

export type MantaProfileOrgMemberMutationResult =
  | { status: 'ok' }
  | { status: 'unconfigured' | 'reconnect-required' | 'forbidden' | 'not-found' }
  | { status: 'conflict'; reason: MantaOrgInviteConflictReason }
  | { status: 'invalid'; reason: MantaOrgMutationInvalidReason }
  | { status: 'failed'; error: string }

export function createDefaultLocalMantaProfile(now: number): MantaProfileSummary {
  return {
    id: DEFAULT_LOCAL_MANTA_PROFILE_ID,
    name: DEFAULT_LOCAL_MANTA_PROFILE_NAME,
    avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
}

function profilePartitionHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getMantaProfileBrowserPartitionSegment(profileId: string): string {
  const safe = profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'profile'
  return `${safe}-${profilePartitionHash(profileId)}`
}

export function getMantaProfileBrowserDefaultPartition(profileId: string): string {
  if (profileId === DEFAULT_LOCAL_MANTA_PROFILE_ID) {
    return MANTA_BROWSER_PARTITION
  }
  return `persist:manta-profile-${getMantaProfileBrowserPartitionSegment(profileId)}-browser-default`
}

export function getMantaProfileBrowserSessionPartition(
  profileId: string,
  browserSessionProfileId: string
): string {
  if (profileId === DEFAULT_LOCAL_MANTA_PROFILE_ID) {
    return `${LEGACY_MANTA_BROWSER_SESSION_PARTITION_PREFIX}${browserSessionProfileId}`
  }
  return `persist:manta-profile-${getMantaProfileBrowserPartitionSegment(
    profileId
  )}-browser-session-${browserSessionProfileId}`
}
