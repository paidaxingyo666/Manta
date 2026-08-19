import type {
  MantaCloudCapabilities,
  MantaCloudOrgSummary,
  MantaProfileCloudSummary
} from '../../shared/manta-profiles'

export type MantaCloudSessionExchangeResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloud: MantaProfileCloudSummary
  organizations?: MantaCloudOrgSummary[]
  capabilities: MantaCloudCapabilities
}
