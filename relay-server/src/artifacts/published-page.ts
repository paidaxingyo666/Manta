/**
 * The public half: `GET /a/{slug}` and the chrome a rendered note is served in.
 *
 * Separate from the API because the audiences are opposite. Everything the API
 * does happens for an authenticated account; everything here happens for a
 * stranger following a link, with no credential and no session, over bytes
 * somebody else wrote. Keeping the two apart makes it hard to reach for a
 * session in the one place there is deliberately never going to be one.
 */
import type { ServerResponse } from 'node:http'
import type { ArtifactStore } from './store.js'

/**
 * The slug a request is asking for, or null when it is asking for something
 * else entirely.
 *
 * Links live at the root of the artifact origin — `share.example.com/<slug>` —
 * because that origin serves nothing but artifacts, so the short form is both
 * available and the one people will be pasting into chat windows.
 *
 * Matched by exact shape rather than by a prefix: a slug is sixteen base64url
 * characters, which cannot collide with `/v1/artifacts` or an ACME challenge,
 * so the root namespace stays unambiguous without reserving anything.
 *
 * `/a/<slug>` still resolves. It is what the first release handed out, and a
 * link someone has already shared is not ours to break.
 */
export function publishedSlug(path: string): string | null {
  const match = /^\/(?:a\/)?([A-Za-z0-9_-]{16})$/.exec(path)
  return match?.[1] ?? null
}

/**
 * Serves a published artifact.
 *
 * Unauthenticated on purpose — that is what sharing means — and every header
 * is about the fact that the body below was written by a stranger. None of
 * them is the isolation, though: the separate origin is, and these only close
 * the escapes that survive it.
 */
export function servePublishedPage(
  store: ArtifactStore,
  rawSlug: string,
  response: ServerResponse
): void {
  const slug = decodeURIComponent(rawSlug)
  const record = store.find(slug, Date.now())
  const body = record ? store.readBody(slug) : null
  if (!record || body === null) {
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    })
    response.end('Not found\n')
    return
  }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // No caching: an artifact is edited in place and its link does not change,
    // so a cached copy is how a correction fails to reach anyone.
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    // Not this origin's to be framed by. An artifact framed inside another page
    // is a clickjacking surface for whatever that page overlays.
    'x-frame-options': 'DENY',
    // The two escapes that survive origin isolation: a form posting the
    // viewer's input somewhere, and a <base> silently retargeting every link.
    'content-security-policy': "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'referrer-policy': 'no-referrer'
  })
  response.end(body)
}

/** Chrome for a rendered markdown page. HTML artifacts are never wrapped. */
export function wrapDocument(title: string, html: string): string {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" type="image/svg+xml">
<title>${safeTitle}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 44rem; line-height: 1.7;
  font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
pre { overflow-x: auto; padding: 0.75rem 1rem; border-radius: 6px; background: rgba(127,127,127,0.12); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
pre code { font-size: 0.88em; }
blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid rgba(127,127,127,0.35); }
img { max-width: 100%; height: auto; }
/* Wide tables scroll inside the page rather than making the page scroll. */
table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; margin: 1rem 0; }
th, td { border: 1px solid rgba(127,127,127,0.3); padding: 0.4rem 0.7rem; text-align: left; }
th { background: rgba(127,127,127,0.1); font-weight: 600; }
li.task { list-style: none; margin-left: -1.2rem; }
li.task input { margin-right: 0.4rem; }
del { opacity: 0.65; }
hr { border: 0; border-top: 1px solid rgba(127,127,127,0.3); margin: 2rem 0; }
</style>
</head>
<body>
${html}
</body>
</html>
`
}
