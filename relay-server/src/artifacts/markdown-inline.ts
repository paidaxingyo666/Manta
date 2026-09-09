/**
 * Inline markdown, over text that has already been HTML-escaped.
 *
 * Escaping happens before any rule here runs, so the only tags in the output
 * are ones this file writes. That is the whole safety argument for rendering
 * markdown in a process that holds credentials: there is no sanitizer to
 * bypass, because nothing is ever passed through.
 */

/** Schemes a link may use. Anything else stays as the text the author typed. */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i
/** Images are fetched by the viewer's browser, so no data: or other schemes. */
const SAFE_IMAGE = /^https?:\/\//i

/**
 * Marks where a code span was lifted out.
 *
 * NUL, and stripped from the source before anything runs, because a printable
 * placeholder would eventually appear in someone's prose and be substituted
 * back out of it.
 */
export const SENTINEL = String.fromCharCode(0)
const SENTINEL_PATTERN = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g')

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Undoes escaping for a URL that is about to be checked for its scheme. */
function unescapeUrl(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
}

/**
 * Inline spans.
 *
 * Order matters twice: code spans come out first so a backtick span containing
 * `**` or a bracket is not re-read as markup, and images run before links
 * because `![alt](src)` contains a link's exact shape.
 */
export function inline(escaped: string): string {
  const codes: string[] = []
  let text = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`)
    return `${SENTINEL}${codes.length - 1}${SENTINEL}`
  })

  text = text.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (match, alt: string, src: string) => {
    if (!SAFE_IMAGE.test(unescapeUrl(src))) {
      return match
    }
    // loading=lazy because a shared note can carry a lot of them, and referrer
    // policy because the page a link was shared from is nobody else's business.
    return `<img src="${src}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`
  })

  text = text.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    if (!SAFE_LINK.test(unescapeUrl(href))) {
      return match
    }
    // rel on every link: these pages are written by whoever published them, and
    // an opener reference would hand one a handle on the page that linked it.
    return `<a href="${href}" rel="noopener noreferrer nofollow" target="_blank">${label}</a>`
  })

  text = text
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>')

  return text.replace(SENTINEL_PATTERN, (_match, index: string) => codes[Number(index)] ?? '')
}
