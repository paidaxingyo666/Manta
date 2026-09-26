import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTreeSync } from '../../shared/windows-transient-lock-removal'
import {
  acquireProfileStateMaintenance,
  acquireProfileStateRuntimeAdmission
} from '../persistence/profile-state/profile-state-access'
import * as database from '../persistence/profile-state/profile-state-database'
import { exportProfileStateJson } from '../persistence/profile-state/profile-state-documents'
import {
  getMantaProfileDataFile,
  getMantaProfileStateDatabaseFile,
  seedNewMantaProfileTelemetryConsent
} from './profile-index-store'

const telemetry = {
  optedIn: false,
  installId: 'retained-install-id',
  existedBeforeTelemetryRelease: true
}
let root: string
const profileId = 'new-profile'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-profile-consent-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTreeSync(root)
})

describe('new profile consent seeding', () => {
  it('inherits consent and install identity directly into SQLite alongside the active runtime', () => {
    const runtime = acquireProfileStateRuntimeAdmission(root)
    try {
      seedNewMantaProfileTelemetryConsent(profileId, telemetry, root)
      const opened = database.openProfileStateDatabaseReadOnly(
        getMantaProfileStateDatabaseFile(profileId, root),
        profileId
      )
      try {
        expect(JSON.parse(exportProfileStateJson(opened.db))).toEqual({ settings: { telemetry } })
      } finally {
        opened.db.close()
      }
      expect(existsSync(getMantaProfileDataFile(profileId, root))).toBe(false)
      expect(() => runtime.assertActive()).not.toThrow()
    } finally {
      runtime.release()
    }
    const maintenance = acquireProfileStateMaintenance(root)
    maintenance.release()
  })

  it('preserves established SQLite consent on a repeated seed', () => {
    seedNewMantaProfileTelemetryConsent(profileId, telemetry, root)
    seedNewMantaProfileTelemetryConsent(profileId, { ...telemetry, installId: 'replacement' }, root)
    const opened = database.openProfileStateDatabaseReadOnly(
      getMantaProfileStateDatabaseFile(profileId, root),
      profileId
    )
    try {
      expect(JSON.parse(exportProfileStateJson(opened.db))).toEqual({ settings: { telemetry } })
    } finally {
      opened.db.close()
    }
  })

  it('preserves existing JSON as input for its later import', () => {
    const path = getMantaProfileDataFile(profileId, root)
    const original = '{"settings":{"telemetry":{"installId":"older"}}}'
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, original)

    seedNewMantaProfileTelemetryConsent(profileId, telemetry, root)

    expect(readFileSync(path, 'utf8')).toBe(original)
    expect(existsSync(getMantaProfileStateDatabaseFile(profileId, root))).toBe(false)
  })

  it('refuses an incapable runtime before admission or profile creation', () => {
    vi.spyOn(database, 'isProfileStateSqliteAvailable').mockReturnValue(false)
    expect(() => seedNewMantaProfileTelemetryConsent(profileId, telemetry, root)).toThrow(
      'bundled Manta runtime'
    )
    expect(existsSync(join(root, '.profile-state-access'))).toBe(false)
    expect(existsSync(join(root, 'profiles'))).toBe(false)
  })

  it('refuses seeding while maintenance owns the root', () => {
    const maintenance = acquireProfileStateMaintenance(root)
    try {
      expect(() => seedNewMantaProfileTelemetryConsent(profileId, telemetry, root)).toThrow()
      expect(existsSync(getMantaProfileStateDatabaseFile(profileId, root))).toBe(false)
    } finally {
      maintenance.release()
    }
  })

  it.each(['manta-data.json.bak.0', 'manta-data.json.sqlite-export.1.json', 'profile-state.db-wal'])(
    'retains missing-authority evidence in %s',
    (name) => {
      const directory = dirname(getMantaProfileDataFile(profileId, root))
      mkdirSync(directory, { recursive: true })
      const evidence = join(directory, name)
      writeFileSync(evidence, 'retained recovery evidence')

      expect(() => seedNewMantaProfileTelemetryConsent(profileId, telemetry, root)).toThrow()

      expect(existsSync(getMantaProfileDataFile(profileId, root))).toBe(false)
      expect(existsSync(getMantaProfileStateDatabaseFile(profileId, root))).toBe(false)
      expect(readFileSync(evidence, 'utf8')).toBe('retained recovery evidence')
    }
  )
})
