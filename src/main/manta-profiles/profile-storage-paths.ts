import { app } from 'electron'
import { join } from 'node:path'

const LEGACY_DATA_FILE_NAME = 'manta-data.json'
const LEGACY_BROWSER_SESSION_META_FILE_NAME = 'browser-session-meta.json'
const PROFILE_INDEX_FILE_NAME = 'manta-profile-index.json'
const PROFILE_DATA_FILE_NAME = 'manta-data.json'
const PROFILE_BROWSER_SESSION_META_FILE_NAME = 'browser-session-meta.json'
const PROFILE_DIRECTORY_NAME = 'profiles'

export const LEGACY_BACKUP_COUNT = 5

let profileUserDataPath: string | null = null

export function initMantaProfilePaths(): void {
  profileUserDataPath = app.getPath('userData')
}

export function getProfileUserDataPath(): string {
  if (!profileUserDataPath) {
    profileUserDataPath = app.getPath('userData')
  }
  return profileUserDataPath
}

export function getMantaProfileIndexPath(userDataPath = getProfileUserDataPath()): string {
  return join(userDataPath, PROFILE_INDEX_FILE_NAME)
}

export function getMantaProfilesDirectory(userDataPath = getProfileUserDataPath()): string {
  return join(userDataPath, PROFILE_DIRECTORY_NAME)
}

export function getMantaProfileDirectory(
  profileId: string,
  userDataPath = getProfileUserDataPath()
): string {
  return join(getMantaProfilesDirectory(userDataPath), profileId)
}

export function getMantaProfileDataFile(
  profileId: string,
  userDataPath = getProfileUserDataPath()
): string {
  return join(getMantaProfileDirectory(profileId, userDataPath), PROFILE_DATA_FILE_NAME)
}

export function getMantaProfileBrowserSessionMetaFile(
  profileId: string,
  userDataPath = getProfileUserDataPath()
): string {
  return join(
    getMantaProfileDirectory(profileId, userDataPath),
    PROFILE_BROWSER_SESSION_META_FILE_NAME
  )
}

export function legacyDataFilePath(userDataPath: string): string {
  return join(userDataPath, LEGACY_DATA_FILE_NAME)
}

export function legacyBrowserSessionMetaPath(userDataPath: string): string {
  return join(userDataPath, LEGACY_BROWSER_SESSION_META_FILE_NAME)
}

export function legacyBackupPath(userDataPath: string, index: number): string {
  return `${legacyDataFilePath(userDataPath)}.bak.${index}`
}

export function profileBackupPath(profileDataFile: string, index: number): string {
  return `${profileDataFile}.bak.${index}`
}
