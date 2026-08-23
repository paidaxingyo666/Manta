import type { ChangelogData } from '../shared/update-status-types'
import { getReleaseNotesUrlForVersion } from '../shared/release-channel'

/**
 * Turns the release notes that shipped inside the update manifest into the
 * card the user sees.
 *
 * This used to fetch a hand-curated JSON from a marketing site. That site does
 * not exist for this fork, so every check spent five seconds timing out before
 * falling back to the plain card — the delay was the whole cost, since the
 * fallback was already the outcome.
 *
 * electron-builder writes `releaseNotes` into every platform's `latest*.yml`
 * from `docs/release-notes/<version>.md` at package time, and electron-updater
 * hands it back on the update-available event. So the notes arrive with the
 * manifest the updater already had to download: no second host, no timeout, no
 * behaviour when offline that differs from being online.
 *
 * The card renders plain text with `pre-line`, so everything below exists to
 * get authored Markdown — or the HTML electron-updater falls back to reading
 * out of the GitHub release body when a version ships no notes file — into
 * something worth reading without a renderer.
 */

/** builder-util-runtime's ReleaseNoteInfo, declared here to avoid the dependency. */
type ReleaseNoteEntry = { version?: string; note?: string | null }

/** The card is 360px wide and the description is not scrollable. */
const MAX_DESCRIPTION_CHARS = 400

const BULLET = /^\s*(?:[-*+]|\d+\.)\s+/
const HEADING = /^\s*#{1,6}\s+/

function flatten(notes: string | ReleaseNoteEntry[] | null | undefined): string {
  if (typeof notes === 'string') {
    return notes
  }
  if (Array.isArray(notes)) {
    // A blank line between entries, not a single break: these are separate
    // releases, and the wrap-folding below would otherwise run them together.
    return notes.map((entry) => entry.note ?? '').join('\n\n')
  }
  return ''
}

/**
 * Markdown syntax is noise once there is nothing to render it. Links keep their
 * text and lose the URL — a bare URL in a 360px card wraps over three lines and
 * is not clickable anyway.
 */
function stripInlineMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '') // electron-updater's GitHub-release fallback is HTML
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\w*])(\*|_)(?!\s)(.+?)(?<!\s)\1(?![\w*])/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** CJK runs together; anything else needs the space the line break stood for. */
function joinWrapped(left: string, right: string): string {
  const cjk = /[　-鿿＀-￯]/
  return cjk.test(left.slice(-1)) && cjk.test(right.slice(0, 1))
    ? `${left}${right}`
    : `${left} ${right}`
}

type Block = { kind: 'heading' | 'bullet' | 'prose'; text: string }

/**
 * Markdown hard-wraps at ~80 columns; the card wraps on its own. Left alone,
 * every authored line break becomes a visible one and the card reads like a
 * torn column, so a wrapped continuation is folded back into its block.
 */
function toBlocks(source: string): Block[] {
  const blocks: Block[] = []
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim()) {
      blocks.push({ kind: 'prose', text: '' }) // paragraph break ends the fold
      continue
    }
    if (HEADING.test(raw)) {
      blocks.push({ kind: 'heading', text: stripInlineMarkup(raw.replace(HEADING, '')) })
      continue
    }
    if (BULLET.test(raw)) {
      blocks.push({ kind: 'bullet', text: stripInlineMarkup(raw.replace(BULLET, '')) })
      continue
    }
    const previous = blocks.at(-1)
    const text = stripInlineMarkup(raw)
    if (previous && previous.text && previous.kind !== 'heading') {
      previous.text = joinWrapped(previous.text, text)
      continue
    }
    blocks.push({ kind: 'prose', text })
  }
  return blocks.filter((block) => block.text)
}

/** Cuts on a line break where possible so the card never ends mid-word. */
function truncate(text: string): string {
  if (text.length <= MAX_DESCRIPTION_CHARS) {
    return text
  }
  const clipped = text.slice(0, MAX_DESCRIPTION_CHARS - 1)
  const lastBreak = clipped.lastIndexOf('\n')
  return `${(lastBreak > MAX_DESCRIPTION_CHARS / 2 ? clipped.slice(0, lastBreak) : clipped).trimEnd()}…`
}

export async function fetchChangelog(
  incomingVersion: string,
  _localVersion: string,
  releaseNotes?: string | ReleaseNoteEntry[] | null
): Promise<ChangelogData | null> {
  const blocks = toBlocks(flatten(releaseNotes))
  if (blocks.length === 0) {
    return null
  }

  // A leading heading names the release; the rest stay as section labels, which
  // is the only thing separating "what changed" from "what does not work yet".
  const title = blocks[0].kind === 'heading' ? blocks[0].text : null
  const description = truncate(
    (title ? blocks.slice(1) : blocks)
      .map((block) => (block.kind === 'bullet' ? `• ${block.text}` : block.text))
      .join('\n')
  )
  if (!description) {
    return null
  }

  return {
    release: {
      title: title ?? `v${incomingVersion}`,
      description,
      releaseNotesUrl: getReleaseNotesUrlForVersion(incomingVersion)
    },
    // Counting how many releases the user skipped needed the full feed. The
    // manifest describes one release, so the card no longer claims a number it
    // cannot know.
    releasesBehind: null
  }
}
