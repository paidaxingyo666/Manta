import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, unlinkSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { BrowserCookieImportResult } from '../../shared/browser-workspace-types'
import { supportsPendingBrowserCookieImportReplay } from './browser-session-cookie-staging'
import {
  isGoogleSourceBoundCookie,
  isNonTransplantableCookieDomain
} from './browser-cookie-import-policy'
import { createChromiumCookieSnapshot } from './chromium-cookie-snapshot'
import { resolveChromiumCookiesPath } from './chromium-cookie-path'
import { copyFileWithWindowsRetry } from '../codex-accounts/fs-utils'
import { planImportWrites } from './browser-cookie-import-write'
import { readChromiumRowPartition } from './browser-cookie-source-partition'
import { diag } from './browser-cookie-import-diagnostics'
import type { DetectedBrowser } from './browser-cookie-detection-types'
import type { CookieImportOptions } from './browser-cookie-import-pipeline'
import type { ChromiumCookieColumnInfo } from './browser-cookie-sqlite'
import type { ChromiumImportContext } from './browser-cookie-chromium-types'
import type { Session } from 'electron'
import { getEncryptionKey } from './browser-cookie-key'

export type ChromiumImportPreparation =
  | { context: ChromiumImportContext }
  | { result: BrowserCookieImportResult }

export async function prepareChromiumCookieImport(
  browser: DetectedBrowser,
  targetPartition: string,
  options: CookieImportOptions,
  targetSession: Session
): Promise<ChromiumImportPreparation> {
  await targetSession.cookies.flushStore()
  const partitionDir = targetSession.getStoragePath()
  if (!partitionDir) {
    return {
      result: { ok: false, reason: 'Target cookie database not found. Open a browser tab first.' }
    }
  }

  const partitionName = targetPartition.replace('persist:', '')
  let liveCookiesPath = resolveChromiumCookiesPath(partitionDir)
  // Why: initialize an unused profile so Chromium creates its Cookies database.
  if (!liveCookiesPath) {
    try {
      await targetSession.cookies.set({ url: 'https://localhost', name: '__init', value: '1' })
      await targetSession.cookies.remove('https://localhost', '__init')
      await targetSession.cookies.flushStore()
    } catch {
      // ignore — flushStore still creates the file on supported Electron versions
    }
    liveCookiesPath = resolveChromiumCookiesPath(partitionDir)
  }
  if (!liveCookiesPath) {
    return {
      result: { ok: false, reason: 'Target cookie database not found. Open a browser tab first.' }
    }
  }

  const stagingDir = join(app.getPath('userData'), 'cookie-import-staging')
  const partitionSegment = partitionName.replace(/[^a-zA-Z0-9_-]/g, '_')
  const stagingCookiesPath = join(
    stagingDir,
    `Cookies-${partitionSegment}-${Date.now()}-${randomUUID()}`
  )
  let stagingAvailable = false
  if (!supportsPendingBrowserCookieImportReplay(targetPartition)) {
    diag(`  restart fallback unsupported for partition "${targetPartition}" — not staging cookies`)
  } else {
    try {
      mkdirSync(stagingDir, { recursive: true })
      copyFileWithWindowsRetry(liveCookiesPath, stagingCookiesPath)
      stagingAvailable = true
    } catch (err) {
      const fsErr = err as NodeJS.ErrnoException
      diag(
        `  staging copy unavailable: code=${fsErr.code ?? 'unknown'} errno=${fsErr.errno ?? 'unknown'} syscall=${fsErr.syscall ?? 'unknown'} path=${liveCookiesPath} destination=${stagingCookiesPath}`
      )
      try {
        unlinkSync(stagingCookiesPath)
      } catch {
        /* best-effort */
      }
    }
  }

  let sourceSnapshot: ReturnType<typeof createChromiumCookieSnapshot>
  try {
    // Why: an open browser may hold cookies in WAL only; snapshot retries avoid pairing the main DB with a racing WAL.
    sourceSnapshot = createChromiumCookieSnapshot(browser.cookiesPath)
  } catch (err) {
    try {
      unlinkSync(stagingCookiesPath)
    } catch {
      /* best-effort */
    }
    diag(`  Chromium snapshot failed: ${String(err)}`)
    return {
      result: {
        ok: false,
        reason: `Could not copy ${browser.label} cookies database. Try closing ${browser.label} first.`
      }
    }
  }

  let sourceDb: InstanceType<typeof DatabaseSync> | null = null
  let stagingDb: InstanceType<typeof DatabaseSync> | null = null
  const closeStagingDb = (): void => {
    try {
      stagingDb?.close()
    } catch {
      /* best-effort */
    }
    stagingDb = null
  }
  const discardStagingFile = (): void => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        unlinkSync(stagingCookiesPath + suffix)
      } catch {
        /* best-effort */
      }
    }
  }

  sourceDb = new DatabaseSync(sourceSnapshot.databasePath, { readOnly: true, readBigInts: true })
  let targetColumnInfo: ChromiumCookieColumnInfo[] | null = null
  let colList: string | null = null
  let placeholders: string | null = null
  if (stagingAvailable) {
    try {
      stagingDb = new DatabaseSync(stagingCookiesPath)
      stagingDb.exec('PRAGMA journal_mode = DELETE')
      targetColumnInfo = stagingDb
        .prepare('PRAGMA table_info(cookies)')
        .all() as ChromiumCookieColumnInfo[]
      const targetCols = targetColumnInfo.map((row) => row.name)
      colList = targetCols.join(', ')
      placeholders = targetCols.map(() => '?').join(', ')
    } catch (err) {
      diag(`  staging database unusable, restart fallback disabled: ${String(err)}`)
      stagingAvailable = false
      targetColumnInfo = null
      colList = null
      placeholders = null
      closeStagingDb()
      discardStagingFile()
    }
  }

  const sourceColumns = new Set(
    (sourceDb.prepare('PRAGMA table_info(cookies)').all() as ChromiumCookieColumnInfo[]).map(
      (column) => column.name
    )
  )
  const sourceRows = sourceDb.prepare('SELECT * FROM cookies ORDER BY rowid').all() as Record<
    string,
    unknown
  >[]
  sourceDb.close()
  sourceDb = null
  diag(`  source has ${sourceRows.length} cookies`)
  if (sourceRows.length === 0) {
    closeStagingDb()
    discardStagingFile()
    return { result: { ok: false, reason: `No cookies found in ${browser.label}.` } }
  }

  const partitionCandidates = sourceRows.flatMap((sourceRow) => {
    const domain = sourceRow.host_key as string
    const name = sourceRow.name as string
    return isGoogleSourceBoundCookie(name, domain) || isNonTransplantableCookieDomain(domain)
      ? []
      : [{ sourceRow, domain, partition: readChromiumRowPartition(sourceRow, sourceColumns) }]
  })
  const nativePlan = planImportWrites(partitionCandidates)
  const plannedSourceRows = new Set(nativePlan.writes.map((candidate) => candidate.sourceRow))
  const partitionBySourceRow = new Map(
    partitionCandidates.map((candidate) => [candidate.sourceRow, candidate.partition])
  )
  if (nativePlan.hasUnrepresentableSkip) {
    closeStagingDb()
    discardStagingFile()
    return {
      result: {
        ok: false,
        reason:
          'Could not import: a cookie with an unreadable site partition has no registrable domain, so its existing session cannot be protected.'
      }
    }
  }

  const needsSourceKey = sourceRows.some((sourceRow) => {
    const encrypted = sourceRow.encrypted_value
    if (!(encrypted instanceof Uint8Array) || encrypted.length === 0) {
      return false
    }
    return (
      !isGoogleSourceBoundCookie(sourceRow.name as string, sourceRow.host_key as string) &&
      !isNonTransplantableCookieDomain(sourceRow.host_key as string)
    )
  })
  const sourceKey = needsSourceKey
    ? getEncryptionKey(browser.keychainService!, browser.keychainAccount!, browser)
    : null
  if (needsSourceKey && !sourceKey) {
    closeStagingDb()
    discardStagingFile()
    return {
      result: {
        ok: false,
        reason: `Could not access ${browser.label} encryption key. The OS may have denied access.`
      }
    }
  }

  let insertStmt: ChromiumImportContext['insertStmt'] = null
  const context: ChromiumImportContext = {
    browser,
    targetPartition,
    options,
    targetSession,
    stagingCookiesPath,
    stagingAvailable,
    sourceSnapshot,
    sourceDb,
    stagingDb,
    targetColumnInfo,
    colList,
    placeholders,
    sourceColumns,
    sourceRows,
    nativePlan,
    plannedSourceRows,
    partitionBySourceRow,
    sourceKey,
    imported: 0,
    skipped: 0,
    decryptFailed: 0,
    appBoundFailed: 0,
    keyringUnavailableFailed: 0,
    integritySkipped: 0,
    nonTransplantableSkipped: 0,
    partitionSkipped: nativePlan.skips.length,
    googleCookiesSkipped: 0,
    memoryLoaded: 0,
    memoryFailed: 0,
    domainSet: new Set<string>(),
    decryptedCookies: [],
    scanned: [],
    sourceDomainValidity: new Map<string, boolean>(),
    insertStmt,
    importScope: {
      exact: new Set<string>(),
      ancestors: new Set<string>(),
      descendantRoots: new Set<string>()
    },
    closeStagingDb,
    discardStagingFile,
    disableStaging: (reason: string): void => {
      diag(`  staging disabled, restart fallback unavailable: ${reason}`)
      context.stagingAvailable = false
      context.insertStmt = null
      context.closeStagingDb()
      context.discardStagingFile()
    }
  } satisfies ChromiumImportContext

  if (context.stagingDb && context.colList && context.placeholders) {
    try {
      context.insertStmt = context.stagingDb.prepare(
        `INSERT OR REPLACE INTO cookies (${context.colList}) VALUES (${context.placeholders})`
      )
      context.stagingDb.exec('BEGIN TRANSACTION')
    } catch (err) {
      context.disableStaging(String(err))
    }
  } else if (context.stagingAvailable) {
    context.disableStaging('staged database exposed no cookies columns')
  }
  if (context.nativePlan.skippedFamilies.size > 0) {
    context.disableStaging(
      `${context.nativePlan.skippedFamilies.size} preserved cookie families cannot be represented in a staged image`
    )
  }
  return { context }
}
