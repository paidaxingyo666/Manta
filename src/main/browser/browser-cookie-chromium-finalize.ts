import type {
  BrowserCookieImportResult,
  BrowserCookieImportSummary
} from '../../shared/browser-workspace-types'
import { browserSessionRegistry } from './browser-session-registry'
import { removeTransplantableCookies } from './browser-cookie-import-clear'
import { openCookieClearStore } from './browser-cookie-clear-store'
import { writeImportedCookies, type SourceCookieToWrite } from './browser-cookie-import-write'
import { deriveUrl } from './browser-cookie-validation'
import { diag } from './browser-cookie-import-diagnostics'
import type { ChromiumImportContext } from './browser-cookie-chromium-types'

export async function finalizeChromiumCookieImport(
  context: ChromiumImportContext
): Promise<BrowserCookieImportResult> {
  if (context.decryptedCookies.length === 0) {
    const zeroPathWarning = context.undecryptableWarning
    context.closeStagingDb()
    context.discardStagingFile()
    return {
      ok: true,
      profileId: '',
      summary: {
        totalCookies: context.sourceRows.length,
        importedCookies: 0,
        skippedCookies:
          context.skipped + context.integritySkipped + context.nonTransplantableSkipped,
        ...(context.googleCookiesSkipped > 0
          ? { googleCookiesSkipped: context.googleCookiesSkipped }
          : {}),
        ...(context.partitionSkipped > 0
          ? { partitionSkippedCookies: context.partitionSkipped }
          : {}),
        domains: [],
        ...(zeroPathWarning ? { warning: zeroPathWarning } : {})
      }
    }
  }

  if (context.stagingDb) {
    try {
      context.stagingDb.exec('COMMIT')
      context.closeStagingDb()
      diag(
        `  SQLite staging complete: ${context.imported} cookies, ${context.domainSet.size} domains`
      )
    } catch (err) {
      context.disableStaging(String(err))
    }
  } else {
    diag(`  staging skipped: ${context.imported} cookies will load in-memory only`)
  }

  const cookieClearStore = openCookieClearStore(context.targetSession)
  try {
    await removeTransplantableCookies(
      {
        cookies: cookieClearStore,
        snapshotClearIdentities: (cookies) => cookieClearStore.snapshotClearIdentities(cookies),
        restoreClearIdentities: (identities) => cookieClearStore.restoreClearIdentities(identities)
      },
      context.nativePlan.skippedFamilies,
      context.importScope
    )
    diag(
      `  cleared existing cookies for ${context.domainSet.size} imported domains before loading ${context.decryptedCookies.length} imported cookies`
    )

    const writable: SourceCookieToWrite[] = []
    for (const cookie of context.decryptedCookies) {
      const url = deriveUrl(cookie.domain, cookie.secure)
      if (!url) {
        context.memoryFailed++
        continue
      }
      writable.push({ ...cookie, url })
    }
    const phase = await writeImportedCookies(cookieClearStore, writable, {
      stopOnFailure: false,
      log: diag
    })
    context.memoryLoaded = phase.importedCount
    context.memoryFailed += phase.writeRejected
  } finally {
    cookieClearStore.dispose()
  }

  diag(
    `  memory load: ${context.memoryLoaded} OK, ${context.memoryFailed} failed, ${context.partitionSkipped} partition-unreadable`
  )

  let warning: BrowserCookieImportSummary['warning']
  if (context.memoryFailed > 0 && context.stagingAvailable) {
    browserSessionRegistry.setPendingCookieImport(
      context.targetPartition,
      context.stagingCookiesPath
    )
    diag(
      `  staged at ${context.stagingCookiesPath} for ${context.memoryFailed} cookies that need restart`
    )
  } else if (context.memoryFailed > 0) {
    browserSessionRegistry.clearPendingCookieImport(context.targetPartition)
    context.discardStagingFile()
    diag(`  ${context.memoryFailed} cookies need a restart but staging is unavailable — skipped`)
    warning = {
      code: 'restart-fallback-unavailable',
      loadedCookies: context.memoryLoaded,
      failedCookies: context.memoryFailed
    }
  } else {
    browserSessionRegistry.clearPendingCookieImport(context.targetPartition)
    context.discardStagingFile()
    diag('  all cookies loaded in-memory — no restart needed')
  }

  if (!warning && context.undecryptableWarning) {
    warning = context.undecryptableWarning
  }

  const summary: BrowserCookieImportSummary = {
    totalCookies: context.sourceRows.length,
    importedCookies: context.imported,
    skippedCookies: context.skipped + context.integritySkipped + context.nonTransplantableSkipped,
    ...(context.googleCookiesSkipped > 0
      ? { googleCookiesSkipped: context.googleCookiesSkipped }
      : {}),
    ...(context.partitionSkipped > 0 ? { partitionSkippedCookies: context.partitionSkipped } : {}),
    domains: [...context.domainSet].sort(),
    ...(warning ? { warning } : {})
  }
  return { ok: true, profileId: '', summary }
}
