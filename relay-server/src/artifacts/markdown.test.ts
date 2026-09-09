import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown.js'

/**
 * The invariant these cover is not "renders markdown well" — it is that the
 * output contains no tag this renderer did not construct. Everything a
 * publisher writes is escaped before any rule runs, so the interesting cases
 * are the ones where a parser that filtered instead would leak.
 */
describe('renderMarkdown escaping', () => {
  it('shows raw HTML as text rather than passing it through', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps an img onerror payload inert', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('does not let a code span smuggle a tag out', () => {
    const html = renderMarkdown('`<b>bold</b>`')
    expect(html).toContain('<code>&lt;b&gt;bold&lt;/b&gt;</code>')
    expect(html).not.toContain('<b>')
  })

  it('refuses a javascript: link and leaves the source visible', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('<a href')
    expect(html).toContain('javascript:alert(1)')
  })

  it('refuses a data: link', () => {
    const html = renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)')
    expect(html).not.toContain('<a href')
  })

  it('links http, https, and mailto, always with rel', () => {
    for (const href of ['https://a.example', 'http://a.example', 'mailto:a@example.com']) {
      const html = renderMarkdown(`[go](${href})`)
      expect(html).toContain(`href="${href}"`)
      expect(html).toContain('rel="noopener noreferrer nofollow"')
    }
  })

  it('escapes a quote inside a link label and href', () => {
    // A raw quote in the href would close the attribute and let the rest of the
    // URL become attributes of the anchor.
    const html = renderMarkdown('[a"b](https://a.example/?q="x")')
    expect(html).toContain('href="https://a.example/?q=&quot;x&quot;"')
    expect(html).toContain('>a&quot;b</a>')
  })
})

describe('renderMarkdown structure', () => {
  it('renders headings, emphasis, rules, and both list kinds', () => {
    const html = renderMarkdown(
      ['# Title', '', 'Some **bold** and _thin_ text.', '', '---', '', '- one', '- two'].join('\n')
    )
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>thin</em>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')

    const ordered = renderMarkdown(['1. first', '2. second'].join('\n'))
    expect(ordered).toContain('<ol>')
    expect(ordered).toContain('<li>second</li>')
  })

  it('closes a list before the block that follows it', () => {
    const html = renderMarkdown(['- one', '', 'after'].join('\n'))
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<p>after</p>'))
  })

  it('switches list kind without nesting one inside the other', () => {
    const html = renderMarkdown(['- bullet', '1. numbered'].join('\n'))
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<ol>'))
  })

  it('keeps a fence open until its own marker returns', () => {
    const html = renderMarkdown(['~~~', '```', 'still code', '~~~', 'after'].join('\n'))
    expect(html).toContain('still code')
    expect(html).toContain('<p>after</p>')
    expect(html.match(/<pre>/g)).toHaveLength(1)
  })

  it('renders an unterminated fence rather than dropping the rest of the file', () => {
    const html = renderMarkdown(['```', 'body line'].join('\n'))
    expect(html).toContain('body line')
  })

  it('renders a block quote', () => {
    expect(renderMarkdown('> quoted')).toContain('<blockquote><p>quoted</p></blockquote>')
  })

  it('leaves numbers in prose alone', () => {
    // The code-span placeholder used to be a bare digit between spaces, which
    // ate text like this and replaced it with nothing.
    expect(renderMarkdown('ready in 5 minutes')).toContain('<p>ready in 5 minutes</p>')
  })

  it('strips a NUL so the source cannot forge a placeholder', () => {
    const forged = `${String.fromCharCode(0)}0${String.fromCharCode(0)} and \`code\``
    const html = renderMarkdown(forged)
    expect(html).toContain('<code>code</code>')
    expect(html).not.toContain(String.fromCharCode(0))
  })
})

describe('what real notes actually contain', () => {
  it('drops YAML front matter instead of rendering it as content', () => {
    // Note tools put title/tags/dates up there. Rendered, it came out as a rule
    // plus a paragraph of YAML — a shared note looking broken before its first
    // heading, which is what sent someone looking for a bug.
    const html = renderMarkdown('---\ntitle: Note\ntags: [a, b]\n---\n\n# Body')
    expect(html).toBe('<h1>Body</h1>')
  })

  it('treats unterminated dashes as a rule, not as front matter', () => {
    const html = renderMarkdown('---\n\ntext')
    expect(html).toContain('<hr>')
    expect(html).toContain('<p>text</p>')
  })

  it('renders a pipe table with its alignments', () => {
    const html = renderMarkdown(
      ['| a | b | c |', '| :-- | :-: | --: |', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |'].join('\n')
    )
    expect(html).toContain('<table>')
    expect(html).toContain('<th style="text-align:left">a</th>')
    expect(html).toContain('<th style="text-align:center">b</th>')
    expect(html).toContain('<th style="text-align:right">c</th>')
    expect(html.match(/<tr>/g)).toHaveLength(3)
  })

  it('leaves pipes alone without a separator row', () => {
    const html = renderMarkdown('a | b | c')
    expect(html).not.toContain('<table>')
    expect(html).toContain('<p>a | b | c</p>')
  })

  it('renders task list items as disabled checkboxes', () => {
    const html = renderMarkdown(['- [ ] todo', '- [x] done'].join('\n'))
    expect(html).toContain('<input type="checkbox" disabled> todo')
    expect(html).toContain('<input type="checkbox" disabled checked> done')
  })

  it('renders an image rather than a link with a stray bang', () => {
    const html = renderMarkdown('![alt](https://a.example/x.png)')
    expect(html).toContain('<img src="https://a.example/x.png" alt="alt"')
    expect(html).not.toContain('!<a')
  })

  it('refuses an image source that is not http', () => {
    // The viewer's browser fetches these, so a data: or javascript: source is
    // not ours to hand it.
    for (const src of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>']) {
      const html = renderMarkdown(`![x](${src})`)
      expect(html).not.toContain('<img')
    }
  })

  it('renders strikethrough', () => {
    expect(renderMarkdown('~~gone~~')).toContain('<del>gone</del>')
  })

  it('still escapes everything inside a table cell', () => {
    // The invariant has to survive every new construct, not just the old ones.
    const html = renderMarkdown(['| a |', '| --- |', '| <script>x</script> |'].join('\n'))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
