import path from 'node:path'
import { installMantadHostAdapters } from '../../../src/main/mantad/mantad-entry'
import type { Store } from '../../../src/main/persistence'
import { createProfileStateStore } from '../../../src/main/persistence/profile-state/profile-state-store-factory'

export function createDaemonGenerationProfileStore(directory: string): Store {
  installMantadHostAdapters()
  // The bundled fixture has no profile writer worker; use the synchronous SQLite authority.
  return createProfileStateStore({
    dataFile: path.join(directory, 'manta-data.json'),
    databaseFile: path.join(directory, 'profile-state.sqlite'),
    profileId: 'legacy-close-fixture'
  }).store
}
