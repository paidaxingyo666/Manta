import { join } from 'node:path'

export const PROFILE_STATE_DATABASE_FILE_NAME = 'profile-state.db'

/** Pure profile-state path helpers shared by the offline CLI and main process. */
export function profileStateDatabaseFile(profileDirectory: string): string {
  return join(profileDirectory, PROFILE_STATE_DATABASE_FILE_NAME)
}

export function getMantaProfileDataFile(profileId: string, userDataPath: string): string {
  return join(userDataPath, 'profiles', profileId, 'manta-data.json')
}

export function getMantaProfileStateDatabaseFile(profileId: string, userDataPath: string): string {
  return profileStateDatabaseFile(join(userDataPath, 'profiles', profileId))
}
