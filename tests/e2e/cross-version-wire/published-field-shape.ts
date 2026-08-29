/**
 * Reading the field shape of a published frame from the frame itself, so a
 * cross-version expectation can be stated against the build that produced it.
 *
 * The baseline this suite pairs against is whichever release tag is newest, and
 * that moves on every cut. An expectation written as a literal list of fields the
 * old side does or does not have therefore expires by itself: the first release
 * containing an already-merged optional field turns the assertion red on whatever
 * pull request happens to be in flight, with no code change anywhere.
 */

export type PublishedFieldSkew = {
  /** Names only the newer side publishes — additive, and safe under Rule 1. */
  added: string[]
  /** Names the older side still publishes and the newer side dropped — a break. */
  removed: string[]
}

/** Sorted union of the keys across one published frame sequence. */
export function publishedFieldNames(payloads: Record<string, unknown>[]): string[] {
  return [...new Set(payloads.flatMap((payload) => Object.keys(payload)))].sort()
}

/**
 * Which field names the two sides disagree on, by direction. Both sides are read
 * from a real pairing; neither is a list this file knows.
 */
export function comparePublishedFields(args: {
  older: string[]
  newer: string[]
}): PublishedFieldSkew {
  const older = new Set(args.older)
  const newer = new Set(args.newer)
  return {
    added: [...newer].filter((name) => !older.has(name)).sort(),
    removed: [...older].filter((name) => !newer.has(name)).sort()
  }
}
