const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function parseSkillShareId(value: string): string | null {
  const trimmed = value.trim()
  if (SHARE_ID_PATTERN.test(trimmed)) {
    return trimmed
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol === 'manta:') {
    const match = `${url.host}${url.pathname}`.match(/^skills\/share\/([A-Za-z0-9_-]{1,128})\/?$/)
    return match?.[1] ?? null
  }
  const developmentHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(developmentHost && url.protocol === 'http:')) {
    return null
  }
  // No host allow-list on purpose: only the id survives this function, and the
  // fetch origin is pinned by resolveArtifactCloudApiUrl. Unlike the artifact
  // API URL, this one is never a destination and carries no token.
  if (url.username || url.password) {
    return null
  }
  const match = url.pathname.match(/^\/skills\/share\/([A-Za-z0-9_-]{1,128})\/?$/)
  return match?.[1] ?? null
}

export function skillShareIdFromArguments(argv: readonly string[]): string | null {
  for (const value of argv) {
    const id = parseSkillShareId(value)
    if (id && (value.includes('/skills/share/') || value.startsWith('manta:'))) {
      return id
    }
  }
  return null
}
