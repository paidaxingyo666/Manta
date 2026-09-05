import { readFileSync } from 'node:fs'
import { z } from 'zod'

export type RelayOpsEnvironmentId = 'production' | 'staging'
export type RelayOpsRegion = 'us-central1' | 'asia-east2'
export type RelayOpsMachineType = 'e2-standard-2' | 'e2-standard-4'

export type RelayOpsCellConfig = {
  cellId: string
  hostname: string
  origin: string
  region: RelayOpsRegion
  zone: string
  machineType: RelayOpsMachineType
  capacityRequests: number
  databasePoolMax: number
  configuredAdmission: boolean
}

export type RelayOpsEnvironment = {
  id: RelayOpsEnvironmentId
  label: string
  project: string
  region: string
  directorOrigin: string
  authOrigin: string
  directorService: string
  authService: string
  sqlInstance: string
  migPrefix: string
  certificateName: string
  cells: RelayOpsCellConfig[]
}

const RegionSchema = z.enum(['us-central1', 'asia-east2'])
const MachineTypeSchema = z.enum(['e2-standard-2', 'e2-standard-4'])
const EnvironmentSchema = z.enum(['production', 'staging'])

function cellOrdinal(cellId: string): number {
  return Number(/c(\d+)$/.exec(cellId)?.[1] ?? 0)
}

function required(body: string, pattern: RegExp, label: string): string {
  const value = pattern.exec(body)?.[1]
  if (!value) throw new Error(`Relay Ops could not read ${label} from durable Terraform config`)
  return value
}

export function relayOpsCellsFromTerraform(input: {
  environment: RelayOpsEnvironmentId
  domain: string
  source: string
}): RelayOpsCellConfig[] {
  const block = /relay_gce_cells\s*=\s*\{([\s\S]*)\n\}/.exec(input.source)?.[1]
  if (!block) throw new Error('Relay Ops could not read durable Relay cells')
  return [...block.matchAll(/"([a-z]+-gce-c\d+)"\s*=\s*\{([\s\S]*?)\n {2}\}/g)]
    .map((match) => {
      const cellId = match[1]!
      const body = match[2]!
      const hostname = required(body, /\bhostname\s*=\s*"([^"]+)"/, `${cellId} hostname`)
      const configuredAdmission = /\binitially_enabled\s*=\s*(true|false)/.exec(body)?.[1]
      return {
        cellId,
        hostname,
        origin: `https://${hostname}.${input.domain}`,
        region: RegionSchema.parse(
          /\bregion\s*=\s*"([^"]+)"/.exec(body)?.[1] ?? 'us-central1'
        ),
        zone: required(body, /\bzone\s*=\s*"([^"]+)"/, `${cellId} zone`),
        machineType: MachineTypeSchema.parse(
          required(body, /\bmachine_type\s*=\s*"([^"]+)"/, `${cellId} machine type`)
        ),
        capacityRequests: Number(
          required(body, /\bcapacity_requests\s*=\s*(\d+)/, `${cellId} capacity`)
        ),
        databasePoolMax: Number(/\bdatabase_pool_max\s*=\s*(\d+)/.exec(body)?.[1] ?? 10),
        configuredAdmission: configuredAdmission === undefined || configuredAdmission === 'true'
      }
    })
    .sort((left, right) => cellOrdinal(left.cellId) - cellOrdinal(right.cellId))
}

function durableCells(environment: RelayOpsEnvironmentId, domain: string): RelayOpsCellConfig[] {
  const source = readFileSync(
    // Repository root; infra/terraform moves with this tree, so the relative depth holds.
    new URL(`../../../infra/terraform/environments/${environment}.tfvars`, import.meta.url),
    'utf8'
  )
  return relayOpsCellsFromTerraform({ environment, domain, source })
}

export const RELAY_OPS_ENVIRONMENTS: Record<RelayOpsEnvironmentId, RelayOpsEnvironment> = {
  production: {
    id: 'production',
    label: 'Production',
    project: 'onorca-cloud',
    region: 'us-central1',
    directorOrigin: 'https://relay.manta.sh.cn',
    authOrigin: 'https://login.manta.sh.cn',
    directorService: 'manta-cloud-relay',
    authService: 'manta-cloud-auth',
    sqlInstance: 'manta-cloud-auth-db',
    migPrefix: 'orca-cloud-relay-gce-',
    certificateName: 'manta-cloud-relay-gce',
    cells: durableCells('production', 'relay.manta.sh.cn')
  },
  staging: {
    id: 'staging',
    label: 'Staging',
    project: 'onorca-cloud-staging',
    region: 'us-central1',
    directorOrigin: 'https://relay-staging.manta.sh.cn',
    authOrigin: 'https://auth-staging.manta.sh.cn',
    directorService: 'manta-cloud-relay-staging',
    authService: 'manta-cloud-auth-staging',
    sqlInstance: 'manta-cloud-staging-auth-db',
    migPrefix: 'orca-cloud-staging-relay-gce-',
    certificateName: 'manta-cloud-staging-relay-gce',
    cells: durableCells('staging', 'relay-staging.manta.sh.cn')
  }
}

export function relayOpsEnvironment(value: unknown): RelayOpsEnvironment {
  return RELAY_OPS_ENVIRONMENTS[EnvironmentSchema.parse(value)]
}
