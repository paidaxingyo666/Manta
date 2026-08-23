import { net } from 'electron'
import { compareVersions, isValidVersion } from './updater-fallback'

export type NudgeConfig = {
  id: string
  minVersion?: string
  maxVersion?: string
}

/** Set to a URL you host to turn the nudge back on. */
const NUDGE_URL: string | null = null

export async function fetchNudge(url: string | null = NUDGE_URL): Promise<NudgeConfig | null> {
  // Same shape as the changelog was: a marketing endpoint this fork does not
  // run, costing five seconds of timeout per check to arrive at the null it
  // would have returned anyway. The parsing below still earns its tests —
  // point the constant at a host you run and it all comes back.
  if (url === null) {
    return null
  }
  try {
    const res = await net.fetch(url, {
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) {
      return null
    }

    const json: unknown = await res.json()
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return null
    }

    const { id, minVersion, maxVersion } = json as Record<string, unknown>
    if (typeof id !== 'string' || !id.trim()) {
      return null
    }

    if (minVersion === undefined && maxVersion === undefined) {
      return null
    }

    if (minVersion !== undefined && typeof minVersion !== 'string') {
      return null
    }
    if (maxVersion !== undefined && typeof maxVersion !== 'string') {
      return null
    }
    if (minVersion !== undefined && !isValidVersion(minVersion)) {
      return null
    }
    if (maxVersion !== undefined && !isValidVersion(maxVersion)) {
      return null
    }
    if (
      minVersion !== undefined &&
      maxVersion !== undefined &&
      compareVersions(minVersion, maxVersion) > 0
    ) {
      return null
    }

    return {
      id: id.trim(),
      minVersion,
      maxVersion
    }
  } catch {
    return null
  }
}

export function versionMatchesRange(
  appVersion: string,
  range: { minVersion?: string; maxVersion?: string }
): boolean {
  if (range.minVersion !== undefined && compareVersions(appVersion, range.minVersion) < 0) {
    return false
  }
  if (range.maxVersion !== undefined && compareVersions(appVersion, range.maxVersion) > 0) {
    return false
  }
  return true
}

export function shouldApplyNudge(args: {
  nudge: NudgeConfig
  appVersion: string
  pendingUpdateNudgeId: string | null
  dismissedUpdateNudgeId: string | null
}): boolean {
  const { nudge, appVersion, pendingUpdateNudgeId, dismissedUpdateNudgeId } = args

  if (nudge.id === pendingUpdateNudgeId || nudge.id === dismissedUpdateNudgeId) {
    return false
  }

  return versionMatchesRange(appVersion, nudge)
}
