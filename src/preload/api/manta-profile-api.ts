import type {
  ConnectCurrentMantaProfileResult,
  CreateCloudLinkedMantaProfileArgs,
  CreateCloudLinkedMantaProfileResult,
  CreateLocalMantaProfileArgs,
  CreateLocalMantaProfileResult,
  FindMantaProfileProjectsByPathArgs,
  FindMantaProfileProjectsByPathResult,
  MantaProfileAuthStatus,
  MantaProfileListResult,
  MantaProfileOrgInviteRevokeArgs,
  MantaProfileOrgMemberChangeRoleArgs,
  MantaProfileOrgMemberInviteArgs,
  MantaProfileOrgMemberMutationResult,
  MantaProfileOrgMemberRemoveArgs,
  MantaProfileOrgMembersListArgs,
  MantaProfileOrgMembersListResult,
  RefreshCurrentMantaProfileAuthResult,
  SelectMantaProfileOrgArgs,
  SelectMantaProfileOrgResult,
  SignOutCurrentMantaProfileResult,
  SwitchMantaProfileArgs,
  SwitchMantaProfileResult,
  TransferMantaProfileProjectArgs,
  TransferMantaProfileProjectResult
} from '../../shared/manta-profiles'
import type { MantaCloudEndpointOverrides } from '../../shared/manta-cloud-endpoints'

export type MantaProfileApi = {
  list: () => Promise<MantaProfileListResult>
  authStatus: () => Promise<MantaProfileAuthStatus>
  createLocal: (args?: CreateLocalMantaProfileArgs) => Promise<CreateLocalMantaProfileResult>
  createCloudLinked: (
    args?: CreateCloudLinkedMantaProfileArgs
  ) => Promise<CreateCloudLinkedMantaProfileResult>
  switchProfile: (args: SwitchMantaProfileArgs) => Promise<SwitchMantaProfileResult>
  transferProject: (
    args: TransferMantaProfileProjectArgs
  ) => Promise<TransferMantaProfileProjectResult>
  findProjectProfiles: (
    args: FindMantaProfileProjectsByPathArgs
  ) => Promise<FindMantaProfileProjectsByPathResult>
  connectCurrent: () => Promise<ConnectCurrentMantaProfileResult>
  refreshAuth: () => Promise<RefreshCurrentMantaProfileAuthResult>
  signOutCurrent: () => Promise<SignOutCurrentMantaProfileResult>
  applyCloudEndpoints: (
    overrides: MantaCloudEndpointOverrides | undefined
  ) => Promise<{ status: 'restarting' }>
  selectOrg: (args: SelectMantaProfileOrgArgs) => Promise<SelectMantaProfileOrgResult>
  orgMembersList: (
    args: MantaProfileOrgMembersListArgs
  ) => Promise<MantaProfileOrgMembersListResult>
  orgMemberInvite: (
    args: MantaProfileOrgMemberInviteArgs
  ) => Promise<MantaProfileOrgMemberMutationResult>
  orgInviteRevoke: (
    args: MantaProfileOrgInviteRevokeArgs
  ) => Promise<MantaProfileOrgMemberMutationResult>
  orgMemberChangeRole: (
    args: MantaProfileOrgMemberChangeRoleArgs
  ) => Promise<MantaProfileOrgMemberMutationResult>
  orgMemberRemove: (
    args: MantaProfileOrgMemberRemoveArgs
  ) => Promise<MantaProfileOrgMemberMutationResult>
}
