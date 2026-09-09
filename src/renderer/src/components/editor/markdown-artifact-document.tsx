/**
 * Renders a markdown file into the standalone page that gets shared.
 *
 * Why here and not on the relay: this app already renders markdown, through a
 * pipeline that parses embedded HTML (`rehype-raw`) and then sanitizes it
 * (`rehype-sanitize`). A relay rendering it a second time would need its own
 * renderer and its own sanitizer, in the process that holds account
 * credentials — and it would render *differently*, so a shared link would not
 * match the preview it was shared from.
 *
 * Sharing the preview's own plugin list is the point. A second list would
 * drift, and the promise being made is that the page someone opens is the page
 * the author was looking at.
 */
import type { Options as ReactMarkdownOptions } from 'react-markdown'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  markdownPreviewSanitizeSchema
} from './MarkdownPreviewBody'

/**
 * The preview's schema, minus `file:`.
 *
 * The preview allows it so a click can be authorized and opened locally. A
 * shared page has no such handler and a different audience: a `file:///Users/…`
 * URL in it would publish the author's directory layout to whoever opens the
 * link, and could never resolve for them anyway.
 */
function shareSanitizeSchema(): typeof markdownPreviewSanitizeSchema {
  const withoutFile = (protocols: readonly string[] | undefined): string[] =>
    (protocols ?? []).filter((protocol) => protocol !== 'file')
  return {
    ...markdownPreviewSanitizeSchema,
    protocols: {
      ...markdownPreviewSanitizeSchema.protocols,
      href: withoutFile(markdownPreviewSanitizeSchema.protocols?.href as string[] | undefined),
      src: withoutFile(markdownPreviewSanitizeSchema.protocols?.src as string[] | undefined)
    }
  }
}

/** Swaps the preview's schema for the share one, leaving the order intact. */
function shareRehypePlugins(): ReactMarkdownOptions['rehypePlugins'] {
  const schema = shareSanitizeSchema()
  return MARKDOWN_REHYPE_PLUGINS.map((plugin) =>
    Array.isArray(plugin) && plugin[1] === markdownPreviewSanitizeSchema
      ? [plugin[0], schema]
      : plugin
  ) as ReactMarkdownOptions['rehypePlugins']
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The body, as HTML.
 *
 * `react-dom/server` and `react-markdown` are imported here rather than at the
 * top so neither lands in the startup bundle; sharing is a deliberate action
 * and can wait a tick for them.
 */
export async function renderMarkdownArtifactBody(markdown: string): Promise<string> {
  const [{ renderToStaticMarkup }, { default: Markdown }] = await Promise.all([
    import('react-dom/server'),
    import('react-markdown')
  ])
  const rendered = renderToStaticMarkup(
    <Markdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={shareRehypePlugins()}>
      {markdown}
    </Markdown>
  )
  return tidyServerMarkup(rendered)
}

/**
 * Removes two things React's server renderer adds that a standalone page
 * should not carry.
 *
 * `<link rel="preload" as="image">` is React 19 hoisting image loads. In an
 * app that is a speed-up; in a page handed to someone else it is a request to
 * a third-party host fired before the reader has seen anything, which is not
 * ours to make on their behalf.
 *
 * The camel-cased attribute names are React's DOM property spellings leaking
 * into markup — `vAlign` is not an HTML attribute and browsers ignore it, so
 * the author's alignment silently does nothing.
 */
function tidyServerMarkup(html: string): string {
  return html
    .replace(/<link\b[^>]*\brel="preload"[^>]*>/g, '')
    .replace(
      /\s(vAlign|charSet|colSpan|rowSpan|className|srcSet)=/g,
      (_match, name: string) => ` ${name.toLowerCase()}=`
    )
    .trimStart()
}

/**
 * A whole document: the rendered body plus enough style to be readable on its
 * own, since nothing of this app travels with it.
 */
export async function renderMarkdownArtifactDocument(
  markdown: string,
  title: string
): Promise<string> {
  const body = await renderMarkdownArtifactBody(markdown)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 46rem; line-height: 1.7;
  font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 2rem 0 0.75rem; }
h1 { font-size: 1.9rem; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1rem; }
a { color: #1f6f9c; }
pre { overflow-x: auto; padding: 0.75rem 1rem; border-radius: 6px; background: rgba(127,127,127,0.12); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
pre code { font-size: 0.88em; background: none; padding: 0; }
:not(pre) > code { background: rgba(127,127,127,0.15); padding: 0.15em 0.35em; border-radius: 4px; }
blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid rgba(127,127,127,0.35);
  color: rgba(127,127,127,0.95); }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; }
th, td { border: 1px solid rgba(127,127,127,0.3); padding: 0.4rem 0.7rem; }
th { background: rgba(127,127,127,0.1); }
hr { border: 0; border-top: 1px solid rgba(127,127,127,0.3); margin: 2rem 0; }
ul, ol { padding-left: 1.4rem; }
li { margin-bottom: 0.3rem; }
</style>
</head>
<body>
${body}
</body>
</html>
`
}
