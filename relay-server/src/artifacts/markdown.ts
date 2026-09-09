/**
 * Markdown to HTML, with no dependencies and no HTML passthrough.
 *
 * Why hand-written rather than a parser plus a sanitizer: this process holds
 * account credentials and session tokens, and its whole dependency surface is
 * two packages. A CommonMark parser and an HTML sanitizer would be the largest
 * thing in it, and the sanitizer would be load-bearing — one bypass and a
 * shared note becomes script on the artifact origin.
 *
 * The order removes that class of bug instead of filtering it: every byte is
 * escaped first, so the only tags in the output are ones this code wrote. Raw
 * HTML in a markdown source is therefore shown as text. That is a real
 * limitation, and the way around it is to publish an HTML artifact, which is
 * served verbatim — and is why the artifact origin has to be its own.
 *
 * Covered: front matter (removed), headings, paragraphs, fenced and inline
 * code, ordered and unordered lists, task lists, tables, block quotes,
 * horizontal rules, emphasis, strikethrough, images, and links.
 */
import { escapeHtml, inline, SENTINEL } from './markdown-inline.js'

export { escapeHtml } from './markdown-inline.js'

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

/**
 * Drops a leading YAML front matter block.
 *
 * Note-taking tools put `title:`, `tags:` and dates up there, and it is
 * metadata about the document rather than part of it. Rendered instead of
 * removed, it came out as a horizontal rule followed by a paragraph of YAML —
 * which is how a shared note looks broken before its first heading.
 */
function stripFrontMatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== '---') {
    return lines
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  // No closing fence means those dashes were a horizontal rule, not metadata.
  return end === -1 ? lines : lines.slice(end + 1)
}

/** A `| --- | :--: |` row, which is what makes the line above it a header. */
function tableAlignments(line: string): string[] | null {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  if (!trimmed.includes('-')) {
    return null
  }
  const alignments: string[] = []
  for (const cell of trimmed.split('|')) {
    const spec = cell.trim()
    if (!/^:?-+:?$/.test(spec)) {
      return null
    }
    const left = spec.startsWith(':')
    const right = spec.endsWith(':')
    alignments.push(left && right ? 'center' : right ? 'right' : left ? 'left' : '')
  }
  return alignments.length > 0 ? alignments : null
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function renderRow(cells: string[], alignments: string[], tag: 'th' | 'td'): string {
  const rendered = cells.map((cell, index) => {
    const align = alignments[index]
    const style = align ? ` style="text-align:${align}"` : ''
    return `<${tag}${style}>${inline(cell)}</${tag}>`
  })
  return `<tr>${rendered.join('')}</tr>`
}

/** Emits a whole table and returns the index of its last consumed line. */
function renderTable(
  lines: string[],
  headerIndex: number,
  alignments: string[],
  out: string[]
): number {
  out.push('<table>')
  out.push(`<thead>${renderRow(splitRow(lines[headerIndex] ?? ''), alignments, 'th')}</thead>`)
  out.push('<tbody>')
  let index = headerIndex + 1
  while (index + 1 < lines.length && (lines[index + 1] ?? '').includes('|')) {
    index += 1
    out.push(renderRow(splitRow(lines[index] ?? ''), alignments, 'td'))
  }
  out.push('</tbody>')
  out.push('</table>')
  return index
}

/** Renders one list item, which may be a task. */
function renderListItem(body: string, out: string[]): void {
  const task = /^\[([ xX])\]\s+(.*)$/.exec(body)
  if (!task) {
    out.push(`<li>${inline(body)}</li>`)
    return
  }
  const checked = (task[1] ?? ' ').toLowerCase() === 'x' ? ' checked' : ''
  // Disabled: a shared page is a copy of a document, not a place to tick
  // things off — nothing here could record the change.
  out.push(
    `<li class="task"><input type="checkbox" disabled${checked}> ${inline(task[2] ?? '')}</li>`
  )
}

/** Renders the supported subset. Never emits a tag it did not construct. */
export function renderMarkdown(source: string): string {
  const normalized = source.split(SENTINEL).join('').replace(/\r\n?/g, '\n')
  const lines = stripFrontMatter(escapeHtml(normalized).split('\n'))
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
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
    // A table only becomes one with its separator row. Without that, these are
    // ordinary lines that happen to contain pipes.
    const alignments = line.includes('|') ? tableAlignments(lines[index + 1] ?? '') : null
    if (alignments) {
      flushBlocks()
      index = renderTable(lines, index, alignments, out)
      continue
    }
    // `>` arrives escaped, which is why this matches the entity.
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
      renderListItem(bullet[1] ?? '', out)
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
