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
import type { ConnectCurrentMantaProfileArgs } from '../../shared/manta-cloud-credentials'
import type { MantaCloudEndpointOverrides } from '../../shared/manta-cloud-endpoints'
import type {
  ForgetMantaRelayHostArgs,
  ForgetMantaRelayHostResult,
  ListMantaRelayHostsResult
} from '../../shared/manta-relay-hosts'
import type { MantaRelaySignInMethods } from '../../shared/manta-relay-sign-in-methods'

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
  connectCurrent: (
    args?: ConnectCurrentMantaProfileArgs
  ) => Promise<ConnectCurrentMantaProfileResult>
  /** How the configured relay expects to be signed in to. */
  relaySignInMethods: () => Promise<MantaRelaySignInMethods>
  listRelayHosts: () => Promise<ListMantaRelayHostsResult>
  forgetRelayHost: (args: ForgetMantaRelayHostArgs) => Promise<ForgetMantaRelayHostResult>
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
