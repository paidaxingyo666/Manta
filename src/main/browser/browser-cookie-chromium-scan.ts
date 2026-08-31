import type { BrowserCookieImportResult } from '../../shared/browser-workspace-types'
import {
  isGoogleSourceBoundCookie,
  isNonTransplantableCookieDomain,
  normalizeCookieImportDomain,
  importedDomainScope
} from './browser-cookie-import-policy'
import { prepareStagedCookiesForImport } from './browser-cookie-staged-import'
import { chromiumTimestampToUnix, buildChromiumCookieInsertParams } from './browser-cookie-sqlite'
import { chromiumSameSite } from './browser-cookie-validation'
import {
  buildUndecryptableWarning,
  cookieEncryptionVersion,
  decryptCookieValueRaw
} from './browser-cookie-decryption'
import { diag } from './browser-cookie-import-diagnostics'
import type { ChromiumImportContext } from './browser-cookie-chromium-types'

/**
 * Decrypts and validates source rows without touching the target cookie jar.
 * Keeping this pass separate makes the write scope derive from one complete plan.
 */
export function scanChromiumCookieRows(
  context: ChromiumImportContext
): BrowserCookieImportResult | null {
  const { sourceRows, sourceKey, plannedSourceRows, partitionBySourceRow, targetColumnInfo } =
    context

  for (const sourceRow of sourceRows) {
    const domain = sourceRow.host_key as string
    const name = sourceRow.name as string

    if (isGoogleSourceBoundCookie(name, domain)) {
      context.integritySkipped++
      continue
    }
    if (isNonTransplantableCookieDomain(domain)) {
      context.nonTransplantableSkipped++
      continue
    }

    const encRaw = sourceRow.encrypted_value
    const encBuf = encRaw instanceof Uint8Array ? Buffer.from(encRaw) : null
    const plainRaw = sourceRow.value
    let decryptedValue: Buffer
    if (encBuf && encBuf.length > 0) {
      const version = cookieEncryptionVersion(encBuf)
      const appBoundIneligible = version === 'v20'
      const keyringIneligible =
        version === 'v11' &&
        sourceKey?.mode === 'aes-128-cbc' &&
        sourceKey.keyringUnavailable === true
      const raw =
        sourceKey && !appBoundIneligible && !keyringIneligible
          ? decryptCookieValueRaw(encBuf, sourceKey)
          : null
      if (!raw) {
        // Why: retain the prefix while it is available so diagnostics identify the failure cause.
        context.decryptFailed++
        if (appBoundIneligible) {
          context.appBoundFailed++
        } else if (keyringIneligible) {
          context.keyringUnavailableFailed++
        }
        context.skipped++
        continue
      }
      decryptedValue = raw
    } else if (plainRaw instanceof Uint8Array) {
      decryptedValue = Buffer.from(plainRaw)
    } else if (typeof plainRaw === 'string') {
      decryptedValue = Buffer.from(plainRaw, 'latin1')
    } else {
      decryptedValue = Buffer.alloc(0)
    }

    let validDomain = context.sourceDomainValidity.get(domain)
    if (validDomain === undefined) {
      validDomain = normalizeCookieImportDomain(domain) !== null
      context.sourceDomainValidity.set(domain, validDomain)
    }
    if (!validDomain) {
      context.skipped++
      continue
    }
    // Decryption failures are counted above; planned family omissions are counted once here.
    if (!plannedSourceRows.has(sourceRow)) {
      context.skipped++
      continue
    }

    const path = sourceRow.path as string
    const secure = sourceRow.is_secure === 1n
    const httpOnly = sourceRow.is_httponly === 1n
    const sameSite = chromiumSameSite(Number(sourceRow.samesite ?? 0))
    const expiresUtc = chromiumTimestampToUnix(sourceRow.expires_utc as bigint)
    const partition = partitionBySourceRow.get(sourceRow)!
    const value = decryptedValue.toString('latin1')
    context.scanned.push({
      entry: {
        decryptedValue,
        value,
        domain,
        name,
        path,
        secure,
        httpOnly,
        sameSite,
        expirationDate: expiresUtc > 0 ? expiresUtc : undefined,
        partition
      },
      sourceRow
    })
  }

  for (const { entry } of context.scanned) {
    context.domainSet.add(entry.domain.startsWith('.') ? entry.domain.slice(1) : entry.domain)
  }
  context.importScope = importedDomainScope([...context.domainSet])

  if (context.stagingDb && context.insertStmt) {
    try {
      prepareStagedCookiesForImport(context.stagingDb, context.importScope)
    } catch (err) {
      context.disableStaging(String(err))
    }
  }

  // EMIT: all downstream writes derive from the one scan, so no row can leak into the jar.
  for (const { entry, sourceRow } of context.scanned) {
    context.decryptedCookies.push(entry)
    if (context.insertStmt && targetColumnInfo) {
      try {
        const params = buildChromiumCookieInsertParams(
          targetColumnInfo,
          sourceRow,
          entry.decryptedValue
        )
        context.insertStmt.run(...params)
      } catch (err) {
        context.disableStaging(String(err))
      }
    }
    context.imported++
  }

  diag(
    `  skipped ${context.integritySkipped} Google integrity cookies (SIDCC/STRP/AEC) and ${context.nonTransplantableSkipped} non-transplantable-domain cookies`
  )
  context.googleCookiesSkipped = context.integritySkipped + context.nonTransplantableSkipped
  context.undecryptableWarning = buildUndecryptableWarning({
    decryptFailed: context.decryptFailed,
    appBoundFailed: context.appBoundFailed,
    keyringUnavailableFailed: context.keyringUnavailableFailed
  })

  if (context.partitionSkipped > 0 && context.options.canReportPartitionSkippedCookies === false) {
    context.closeStagingDb()
    context.discardStagingFile()
    return {
      ok: false,
      reason:
        'This Manta client cannot report cookies skipped for an unreadable site partition. Update Manta on this device and try again.'
    }
  }
  return null
}
