import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { MantaProfileCloudSummary, MantaProfileSummary } from '../../shared/manta-profiles'
import { bestEffortFsyncDirectorySync, writeDurableSecureJsonFile } from '../../shared/secure-file'
import { clearArtifactCreateIntents } from '../artifacts/artifact-create-intent-store'
import { clearArtifactShareRecords } from '../artifacts/artifact-share-record-store'
import { getMantaProfileDirectory } from './profile-storage-paths'

type ArtifactCloudCleanupMarker = {
  version: 1
  phase: 'prepared' | 'committed'
  targetIdentity: string
}

function cleanupMarkerPath(profileId: string, userDataPath: string): string {
  return join(getMantaProfileDirectory(profileId, userDataPath), 'artifact-cloud-cleanup.json')
}

export function artifactCloudIdentity(cloud: MantaProfileCloudSummary | undefined): string {
  return cloud
    ? JSON.stringify([cloud.userId, cloud.cloudProfileId, cloud.activeOrgId ?? ''])
    : 'local'
}

export function prepareArtifactCloudCleanup(
  profileId: string,
  userDataPath: string,
  targetCloud: MantaProfileCloudSummary | undefined
): void {
  writeDurableSecureJsonFile(cleanupMarkerPath(profileId, userDataPath), {
    version: 1,
    phase: 'prepared',
    targetIdentity: artifactCloudIdentity(targetCloud)
  } satisfies ArtifactCloudCleanupMarker)
}

function readCleanupMarker(
  profileId: string,
  userDataPath: string
): ArtifactCloudCleanupMarker | null {
  const path = cleanupMarkerPath(profileId, userDataPath)
  if (!existsSync(path)) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error('Artifact cloud cleanup marker could not be read safely.', { cause: error })
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Partial<ArtifactCloudCleanupMarker>).version !== 1 ||
    !['prepared', 'committed'].includes(
      (parsed as Partial<ArtifactCloudCleanupMarker>).phase ?? ''
    ) ||
    typeof (parsed as Partial<ArtifactCloudCleanupMarker>).targetIdentity !== 'string'
  ) {
    throw new Error('Artifact cloud cleanup marker has an unsupported format.')
  }
  return parsed as ArtifactCloudCleanupMarker
}

export function artifactCloudCleanupNeedsCommit(
  profileId: string,
  userDataPath: string,
  targetCloud: MantaProfileCloudSummary | undefined
): boolean {
  const marker = readCleanupMarker(profileId, userDataPath)
  return (
    marker?.phase === 'prepared' && marker.targetIdentity === artifactCloudIdentity(targetCloud)
  )
}

export function commitArtifactCloudCleanup(
  profileId: string,
  userDataPath: string,
  targetCloud: MantaProfileCloudSummary | undefined
): void {
  const targetIdentity = artifactCloudIdentity(targetCloud)
  const marker = readCleanupMarker(profileId, userDataPath)
  if (marker?.phase !== 'prepared' || marker.targetIdentity !== targetIdentity) {
    throw new Error('Artifact cloud cleanup marker does not match the profile transition.')
  }
  writeDurableSecureJsonFile(cleanupMarkerPath(profileId, userDataPath), {
    version: 1,
    phase: 'committed',
    targetIdentity
  } satisfies ArtifactCloudCleanupMarker)
}

export function completeArtifactCloudCleanupIfCommitted(
  profileId: string,
  userDataPath: string,
  currentCloud: MantaProfileCloudSummary | undefined
): void {
  const marker = readCleanupMarker(profileId, userDataPath)
  if (
    marker?.phase !== 'committed' ||
    marker.targetIdentity !== artifactCloudIdentity(currentCloud)
  ) {
    return
  }
  clearArtifactCreateIntents(profileId, userDataPath)
  clearArtifactShareRecords(profileId, userDataPath)
  rmSync(cleanupMarkerPath(profileId, userDataPath), { force: true })
  bestEffortFsyncDirectorySync(getMantaProfileDirectory(profileId, userDataPath))
}

function assertArtifactCloudCleanupReady(
  profileId: string,
  userDataPath: string,
  currentCloud: MantaProfileCloudSummary | undefined
): void {
  const marker = readCleanupMarker(profileId, userDataPath)
  if (
    marker?.phase === 'prepared' &&
    marker.targetIdentity === artifactCloudIdentity(currentCloud)
  ) {
    throw new Error('The Manta profile transition must be retried before publishing artifacts.')
  }
}

export function prepareArtifactCloudUse(
  profile: Pick<MantaProfileSummary, 'id' | 'cloud'>,
  userDataPath: string
): void {
  completeArtifactCloudCleanupIfCommitted(profile.id, userDataPath, profile.cloud)
  assertArtifactCloudCleanupReady(profile.id, userDataPath, profile.cloud)
}
