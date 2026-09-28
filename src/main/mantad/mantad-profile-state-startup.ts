import { createProfileStateStoreForStartup } from '../persistence/profile-state/profile-state-startup-authority'
import type { ProfileStateStoreFactoryResult } from '../persistence/profile-state/profile-state-store-factory'
import {
  ensureActiveMantaProfile,
  initMantaProfilePaths
} from '../manta-profiles/profile-index-store'
import { initSshHostKeyStoreFile } from '../ssh/ssh-host-key-store'
import { emitOrcadProfileStateAuthoritySelected } from './mantad-profile-state-telemetry'

export type OrcadProfileStateProfile = {
  dataFile: string
  stateDatabaseFile: string
  profile: { id: string }
}

export type OrcadProfileStateStartup = {
  store: ProfileStateStoreFactoryResult['store']
  authority: {
    backend: ProfileStateStoreFactoryResult['backend']
    classification: ProfileStateStoreFactoryResult['classification']
    authority_mode: 'sqlite-established'
    runtime: 'mantad'
    migrated: boolean
  }
}

/** Build the headless Store and publish its authority selection at one Node-only seam. */
export async function createOrcadProfileStateStartup(
  userDataPath: string
): Promise<OrcadProfileStateStartup> {
  initMantaProfilePaths()
  const profile = ensureActiveMantaProfile(userDataPath)
  const result = await createProfileStateStoreForStartup({
    dataFile: profile.dataFile,
    databaseFile: profile.stateDatabaseFile,
    profileId: profile.profile.id,
    runtime: 'mantad',
    storageAuthority: 'runtime'
  })
  const authority = {
    backend: result.backend,
    classification: result.classification,
    authority_mode: 'sqlite-established' as const,
    runtime: 'mantad' as const,
    migrated: result.migrated
  }
  try {
    initSshHostKeyStoreFile(profile.dataFile)
    emitOrcadProfileStateAuthoritySelected(authority)
    return { store: result.store, authority }
  } catch (error) {
    try {
      await result.store.freezeWritesAsync()
    } catch (closeError) {
      console.error(
        '[persistence] Failed to close profile persistence after startup failure:',
        closeError
      )
    }
    throw error
  }
}
