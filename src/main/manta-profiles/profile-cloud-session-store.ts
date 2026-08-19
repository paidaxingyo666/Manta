import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { writeSecureJsonFile } from '../../shared/secure-file'
import type {
  MantaCloudCapabilities,
  MantaCloudOrgSummary,
  MantaCloudSessionPersistence
} from '../../shared/manta-profiles'
import { getMantaProfileDirectory } from './profile-storage-paths'
import { allowsPlaintextMantaCloudSession } from './profile-cloud-auth-config'
import type { MantaCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import {
  cloudSessionIdentity,
  isCloudSessionMutationCurrent,
  recordSuccessfulCloudSessionLogin,
  type CloudSessionMutationSnapshot
} from './profile-cloud-session-mutation'

export type MantaCloudSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  capabilities: MantaCloudCapabilities
  organizations?: MantaCloudOrgSummary[]
}

export type MantaCloudSessionReadResult =
  | { status: 'found'; session: MantaCloudSession; persistence: MantaCloudSessionPersistence }
  | { status: 'missing'; persistence: 'none' }
  | { status: 'decrypt-failed'; persistence: 'none'; error: string }

type PersistedEncryptedSession = {
  version: 1
  format: 'electron-safe-storage-v1'
  savedAt: number
  ciphertext: string
}

type PersistedPlaintextSession = {
  version: 1
  format: 'dev-plaintext-v1'
  savedAt: number
  session: MantaCloudSession
}

type CachedMantaCloudSession = {
  session: MantaCloudSession
  persistence: Exclude<MantaCloudSessionPersistence, 'none'>
}

const memorySessions = new Map<string, CachedMantaCloudSession>()

function sessionCacheKey(profileId: string, userDataPath: string): string {
  return `${userDataPath}\0${profileId}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMantaCloudSession(value: unknown): value is MantaCloudSession {
  if (!isObject(value) || !isObject(value.capabilities) || !isObject(value.capabilities.flags)) {
    return false
  }
  if (value.organizations !== undefined && !isMantaCloudOrganizations(value.organizations)) {
    return false
  }
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.capabilities.refreshedAt === 'number' &&
    Number.isFinite(value.capabilities.refreshedAt)
  )
}

function isMantaCloudOrganizations(value: unknown): value is MantaCloudOrgSummary[] {
  if (!Array.isArray(value)) {
    return false
  }
  return value.every((organization) => {
    if (!isObject(organization)) {
      return false
    }
    return (
      typeof organization.orgId === 'string' &&
      organization.orgId.length > 0 &&
      typeof organization.name === 'string' &&
      organization.name.length > 0 &&
      (organization.role === undefined || typeof organization.role === 'string')
    )
  })
}

export function getMantaCloudSessionPath(profileId: string, userDataPath: string): string {
  return join(getMantaProfileDirectory(profileId, userDataPath), 'account-session.json.enc')
}

export function saveMantaCloudSession(
  profileId: string,
  userDataPath: string,
  session: MantaCloudSession
): MantaCloudSessionPersistence {
  const cacheKey = sessionCacheKey(profileId, userDataPath)
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted: PersistedEncryptedSession = {
      version: 1,
      format: 'electron-safe-storage-v1',
      savedAt: Date.now(),
      ciphertext: safeStorage.encryptString(JSON.stringify(session)).toString('base64')
    }
    writeSecureJsonFile(getMantaCloudSessionPath(profileId, userDataPath), encrypted)
    memorySessions.set(cacheKey, { session, persistence: 'encrypted' })
    return 'encrypted'
  }

  if (allowsPlaintextMantaCloudSession()) {
    const plaintext: PersistedPlaintextSession = {
      version: 1,
      format: 'dev-plaintext-v1',
      savedAt: Date.now(),
      session
    }
    writeSecureJsonFile(getMantaCloudSessionPath(profileId, userDataPath), plaintext)
    memorySessions.set(cacheKey, { session, persistence: 'dev-plaintext' })
    return 'dev-plaintext'
  }

  // Why: Manta account refresh tokens must not silently fall back to plaintext
  // in production. Memory-only keeps cloud features usable until restart.
  memorySessions.set(cacheKey, { session, persistence: 'memory-only' })
  return 'memory-only'
}

export function saveMantaCloudSessionExchange(
  profileId: string,
  userDataPath: string,
  exchange: MantaCloudSessionExchangeResponse
): MantaCloudSessionPersistence {
  recordSuccessfulCloudSessionLogin(cloudSessionIdentity(profileId, exchange.cloud), userDataPath)
  return saveMantaCloudSession(profileId, userDataPath, {
    accessToken: exchange.accessToken,
    refreshToken: exchange.refreshToken,
    expiresAt: exchange.expiresAt,
    organizations: exchange.organizations,
    capabilities: exchange.capabilities
  })
}

export function saveMantaCloudSessionIfCurrent(
  profileId: string,
  userDataPath: string,
  session: MantaCloudSession,
  snapshot: CloudSessionMutationSnapshot
): MantaCloudSessionPersistence | null {
  // Why: the check and sync save share one main-process turn, so an async
  // refresh captured before sign-out/org-switch cannot resurrect the session.
  if (!isCloudSessionMutationCurrent(profileId, userDataPath, snapshot)) {
    return null
  }
  return saveMantaCloudSession(profileId, userDataPath, session)
}

export function readMantaCloudSession(
  profileId: string,
  userDataPath: string
): MantaCloudSessionReadResult {
  const cacheKey = sessionCacheKey(profileId, userDataPath)
  const memorySession = memorySessions.get(cacheKey)
  if (memorySession) {
    return {
      status: 'found',
      session: memorySession.session,
      persistence: memorySession.persistence
    }
  }

  const path = getMantaCloudSessionPath(profileId, userDataPath)
  if (!existsSync(path)) {
    return { status: 'missing', persistence: 'none' }
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as
      | PersistedEncryptedSession
      | PersistedPlaintextSession
    if (parsed.version !== 1) {
      return { status: 'decrypt-failed', persistence: 'none', error: 'Unsupported session format.' }
    }
    if (parsed.format === 'electron-safe-storage-v1') {
      if (!safeStorage.isEncryptionAvailable()) {
        return {
          status: 'decrypt-failed',
          persistence: 'none',
          error: 'OS-backed encryption is unavailable.'
        }
      }
      const decrypted = safeStorage.decryptString(Buffer.from(parsed.ciphertext, 'base64'))
      const session = JSON.parse(decrypted) as MantaCloudSession
      if (!isMantaCloudSession(session)) {
        return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
      }
      memorySessions.set(cacheKey, { session, persistence: 'encrypted' })
      return { status: 'found', session, persistence: 'encrypted' }
    }
    if (parsed.format === 'dev-plaintext-v1' && allowsPlaintextMantaCloudSession()) {
      if (!isMantaCloudSession(parsed.session)) {
        return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
      }
      memorySessions.set(cacheKey, { session: parsed.session, persistence: 'dev-plaintext' })
      return { status: 'found', session: parsed.session, persistence: 'dev-plaintext' }
    }
    return { status: 'decrypt-failed', persistence: 'none', error: 'Unsafe session format.' }
  } catch {
    return {
      status: 'decrypt-failed',
      persistence: 'none',
      error: 'Could not decrypt saved Manta account session.'
    }
  }
}

export function clearMantaCloudSession(profileId: string, userDataPath: string): void {
  memorySessions.delete(sessionCacheKey(profileId, userDataPath))
  rmSync(getMantaCloudSessionPath(profileId, userDataPath), { force: true })
}
