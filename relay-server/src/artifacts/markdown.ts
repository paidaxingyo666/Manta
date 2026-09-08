/**
 * Markdown to HTML, with no dependencies and no HTML passthrough.
 *
 * Why hand-written rather than a parser plus a sanitizer: this process holds
 * account credentials and session tokens, and its whole dependency surface is
 * two packages. A CommonMark parser and an HTML sanitizer would be the largest
 * thing in it, and the sanitizer would be load-bearing — one bypass and a
 * shared note becomes script on the artifact origin.
 *
 * The order here removes that class of bug instead of filtering it: every byte
 * is escaped first, so the only tags in the output are ones this file wrote.
 * Raw HTML in the source is shown as text, which is a documented limitation
 * rather than a hole. Authors who need real HTML publish an HTML artifact,
 * which is served verbatim and is why the artifact origin must be its own.
 *
 * The supported subset is deliberately small: headings, paragraphs, fenced and
 * inline code, ordered and unordered lists, block quotes, horizontal rules,
 * emphasis, and links to http, https, and mailto.
 */

const SAFE_LINK = /^(https?:\/\/|mailto:)/i

/**
 * Marks where a code span was lifted out.
 *
 * NUL, and stripped from the source before anything runs, because a printable
 * placeholder cannot work: whatever shape it took would eventually appear in
 * someone's prose and be substituted back out of it.
 */
const SENTINEL = String.fromCharCode(0)
const SENTINEL_PATTERN = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g')

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Inline spans, over already-escaped text.
 *
 * Code spans are taken first and held aside, so a backtick span containing `**`
 * or a bracket is not then re-read as emphasis or a link.
 */
function inline(escaped: string): string {
  const codes: string[] = []
  let text = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`)
    return `${SENTINEL}${codes.length - 1}${SENTINEL}`
  })

  text = text.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    // The href arrives escaped, so the entities have to come back out for the
    // scheme check and stay escaped in the attribute, where that form is right.
    const raw = href
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
    if (!SAFE_LINK.test(raw)) {
      return match
    }
    // rel on every link: these pages are written by whoever published them, and
    // an opener reference would hand one a handle on the page that linked it.
    return `<a href="${href}" rel="noopener noreferrer nofollow" target="_blank">${label}</a>`
  })

  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>')

  return text.replace(SENTINEL_PATTERN, (_match, index: string) => codes[Number(index)] ?? '')
}

type ListState = { tag: 'ul' | 'ol'; open: boolean }

function closeList(out: string[], list: ListState): void {
  if (list.open) {
    out.push(`</${list.tag}>`)
    list.open = false
  }
}

function openList(out: string[], list: ListState, tag: 'ul' | 'ol'): void {
  if (list.open && list.tag !== tag) {
    closeList(out, list)
  }
  if (!list.open) {
    out.push(`<${tag}>`)
    list.tag = tag
    list.open = true
  }
}

/** Renders the supported subset. Never emits a tag it did not construct. */
export function renderMarkdown(source: string): string {
  const normalized = source.split(SENTINEL).join('').replace(/\r\n?/g, '\n')
  const lines = escapeHtml(normalized).split('\n')
  const out: string[] = []
  const list: ListState = { tag: 'ul', open: false }
  let paragraph: string[] = []
  let quote: string[] = []
  let fence: { marker: string; body: string[] } | null = null

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const flushQuote = (): void => {
    if (quote.length > 0) {
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`)
      quote = []
    }
  }
  const flushBlocks = (): void => {
    flushParagraph()
    flushQuote()
    closeList(out, list)
  }

  for (const line of lines) {
    if (fence) {
      // Only the same marker closes the fence, so ``` inside a ~~~ block stays
      // content rather than ending it early.
      if (line.trimEnd() === fence.marker) {
        out.push(`<pre><code>${fence.body.join('\n')}</code></pre>`)
        fence = null
      } else {
        fence.body.push(line)
      }
      continue
    }
    const fenceStart = /^\s*(```|~~~)/.exec(line)
    if (fenceStart) {
      flushBlocks()
      fence = { marker: fenceStart[1] ?? '```', body: [] }
      continue
    }
    if (!line.trim()) {
      flushBlocks()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushBlocks()
      const level = (heading[1] ?? '#').length
      out.push(`<h${level}>${inline((heading[2] ?? '').trim())}</h${level}>`)
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushBlocks()
      out.push('<hr>')
      continue
    }
    // `>` is already escaped by the time this runs.
    const quoted = /^\s*&gt;\s?(.*)$/.exec(line)
    if (quoted) {
      flushParagraph()
      closeList(out, list)
      quote.push(quoted[1] ?? '')
      continue
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      flushQuote()
      openList(out, list, 'ul')
      out.push(`<li>${inline(bullet[1] ?? '')}</li>`)
      continue
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      flushParagraph()
      flushQuote()
      openList(out, list, 'ol')
      out.push(`<li>${inline(numbered[1] ?? '')}</li>`)
      continue
    }
    flushQuote()
    closeList(out, list)
    paragraph.push(line.trim())
  }

  if (fence) {
    // An unterminated fence is still content; dropping it would lose the tail
    // of the document with no sign that anything went missing.
    out.push(`<pre><code>${fence.body.join('\n')}</code></pre>`)
  }
  flushBlocks()
  return out.join('\n')
}
