/**
 * Where a skill package may be downloaded from.
 *
 * This is a real control, not a branding leftover: it decides which host can
 * hand this machine an archive that is unpacked into a skill directory and run
 * by an agent. So it stays an allow-list.
 *
 * What changed for this fork is only who owns the list. Upstream hardcoded its
 * own bucket and honoured MANTA_SKILL_PACKAGE_DOWNLOAD_ORIGINS in development
 * builds only, which is correct when you run the one skill service there is —
 * and leaves a self-hosting operator with a feature that gets all the way to
 * the install button and then fails at the download. The bucket stays as the
 * default; the operator can now name their own host in a packaged build too,
 * and every origin they name is checked for the same shape the artifact API
 * URL is.
 */

/** Upstream's bucket. Still correct for skills published through their service. */
const DEFAULT_DOWNLOAD_ORIGIN = 'https://storage.googleapis.com'

const ENV_VAR = 'MANTA_SKILL_PACKAGE_DOWNLOAD_ORIGINS'

/**
 * Rejects anything that is not a bare https origin. Loopback http is allowed
 * only where plain http is allowed at all, which is the caller's decision.
 */
function validDownloadOrigin(candidate: string, allowLoopbackHttp: boolean): string | null {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && allowLoopbackHttp)) {
    return null
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return null
  }
  return url.origin
}

export function resolveSkillPackageDownloadOrigins(
  options: { allowLoopbackHttp?: boolean; env?: NodeJS.ProcessEnv } = {}
): string[] {
  const { allowLoopbackHttp = false, env = process.env } = options
  const configured = env[ENV_VAR]
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const valid = validDownloadOrigin(origin, allowLoopbackHttp)
      if (!valid) {
        // Why warn rather than throw: one bad entry must not take down skill
        // installation entirely, but a silently ignored origin looks exactly
        // like the feature being broken.
        console.warn(`[skills] ignoring ${ENV_VAR} entry that is not a bare origin: ${origin}`)
      }
      return valid
    })
    .filter((origin): origin is string => origin !== null)

  return [...new Set([DEFAULT_DOWNLOAD_ORIGIN, ...(configured ?? [])])]
}
