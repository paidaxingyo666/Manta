/**
 * The artifact surface over real HTTP against a real relay.
 *
 * Everything here goes through fetch rather than calling the handler, because
 * the parts most likely to be wrong are the ones a direct call skips: the
 * status codes the desktop branches on, the headers the public page carries,
 * and the fact that the bearer is the auth server's session and not a
 * credential this module invented.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertArtifactOrigins } from './config.js'
import { PER_USER, startTestRelay, type TestRelay } from './testing/harness.js'

let current: TestRelay | null = null
const dirs: string[] = []

afterEach(async () => {
  await current?.stop()
  current = null
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const SHARE_ORIGIN = 'https://share.example.test'

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'manta-relay-artifacts-'))
  dirs.push(dir)
  return dir
}

async function startWithArtifacts(extra: Record<string, unknown> = {}): Promise<TestRelay> {
  const dataDir = tempDir()
  return startTestRelay(() => ({
    ...PER_USER,
    dataDir,
    artifacts: {
      enabled: true,
      publicUrl: SHARE_ORIGIN,
      maxBytes: 10 * 1024 * 1024,
      ttlMs: 30 * 24 * 60 * 60_000,
      maxPerAccount: 100,
      maxTotalBytesPerAccount: 256 * 1024 * 1024,
      ...extra
    }
  })) as Promise<TestRelay>
}

async function signIn(origin: string, email = 'ada@example.com'): Promise<string> {
  const response = await fetch(`${origin}/v1/desktop/auth/register`, {
    method: 'POST',
    headers: { connection: 'close', 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse' })
  })
  if (!response.ok) {
    throw new Error(`register failed: ${response.status}`)
  }
  return ((await response.json()) as { accessToken: string }).accessToken
}

function api(
  origin: string,
  path: string,
  token: string,
  init: { method?: string; body?: unknown; editToken?: string; idempotencyKey?: string } = {}
): Promise<Response> {
  return fetch(`${origin}/v1/artifacts${path}`, {
    method: init.method ?? 'GET',
    headers: {
      connection: 'close',
      authorization: `Bearer ${token}`,
      ...(init.editToken ? { 'x-manta-edit-token': init.editToken } : {}),
      ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {})
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  })
}

/**
 * A request with a Host header of our choosing.
 *
 * Not fetch: undici treats Host as a forbidden header and drops it silently,
 * so a test written with fetch would pass against a relay that ignored the
 * origin entirely — it would never have sent the header being tested.
 */
function requestWithHost(
  origin: string,
  path: string,
  host: string,
  method = 'GET'
): Promise<number> {
  const target = new URL(origin)
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: target.hostname, port: target.port, path, method, headers: { host } },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      }
    )
    request.on('error', reject)
    request.end()
  })
}

const HTML_BODY = {
  content: '<h1>Report</h1>',
  contentType: 'text/html',
  fileName: 'report.html',
  title: 'Report'
}

type Created = {
  artifact: { slug: string; expiresAt: string; byteSize: number; sourceContentType: string }
  shareUrl: string
  editToken: string
}

describe('artifact hosting is off unless asked for', () => {
  it('answers 404 on the API and the public path when disabled', async () => {
    current = await startTestRelay(() => PER_USER)
    const token = await signIn(current.origin)
    expect((await api(current.origin, '', token)).status).toBe(404)
    expect((await fetch(`${current.origin}/AAAAAAAAAAAAAAAA`)).status).toBe(404)
    expect(current.relay.artifacts).toBeNull()
  })
})

describe('artifact origin separation', () => {
  it('refuses to start when the artifact origin is the relay origin', () => {
    // A published artifact runs on the origin that serves it. Sharing the
    // relay's would let one call the relay's endpoints as the signed-in
    // desktop, so this is fatal rather than discouraged.
    expect(() =>
      assertArtifactOrigins({
        publicUrl: 'https://relay.example.test',
        artifacts: { enabled: true, publicUrl: 'https://relay.example.test' }
      })
    ).toThrow(/must not be the relay origin/)
  })

  it('requires an origin to publish links against', () => {
    expect(() =>
      assertArtifactOrigins({
        publicUrl: 'https://relay.example.test',
        artifacts: { enabled: true, publicUrl: '' }
      })
    ).toThrow(/is required/)
  })

  it('refuses an origin carrying a path', () => {
    expect(() =>
      assertArtifactOrigins({
        publicUrl: 'https://relay.example.test',
        artifacts: { enabled: true, publicUrl: 'https://share.example.test/files' }
      })
    ).toThrow(/bare origin/)
  })

  it('says nothing about any of it while the feature is off', () => {
    expect(() =>
      assertArtifactOrigins({
        publicUrl: 'https://relay.example.test',
        artifacts: { enabled: false, publicUrl: '' }
      })
    ).not.toThrow()
  })
})

describe('publishing', () => {
  it('creates, lists, updates, and deletes through the desktop contract', async () => {
    current = await startWithArtifacts()
    const token = await signIn(current.origin)

    const created = await api(current.origin, '', token, { method: 'POST', body: HTML_BODY })
    expect(created.status).toBe(201)
    const body = (await created.json()) as Created
    expect(body.shareUrl).toBe(`${SHARE_ORIGIN}/${body.artifact.slug}`)
    expect(body.editToken).toBeTruthy()
    expect(body.artifact.sourceContentType).toBe('text/html')
    expect(Date.parse(body.artifact.expiresAt)).toBeGreaterThan(Date.now())

    const listed = await api(current.origin, '', token)
    expect(listed.status).toBe(200)
    const page = (await listed.json()) as { artifacts: { artifact: { slug: string } }[] }
    expect(page.artifacts.map((entry) => entry.artifact.slug)).toEqual([body.artifact.slug])

    const updated = await api(current.origin, `/${body.artifact.slug}`, token, {
      method: 'PUT',
      editToken: body.editToken,
      body: { ...HTML_BODY, content: '<h1>Revised</h1>' }
    })
    expect(updated.status).toBe(200)
    expect(await (await fetch(`${current.origin}/${body.artifact.slug}`)).text()).toContain(
      'Revised'
    )

    const deleted = await api(current.origin, `/${body.artifact.slug}`, token, {
      method: 'DELETE',
      editToken: body.editToken
    })
    expect(deleted.status).toBe(204)
    expect((await fetch(`${current.origin}/${body.artifact.slug}`)).status).toBe(404)
  })

  it('replays a create whose response was lost, with the same edit token', async () => {
    // The desktop retries with the same key and needs the same answer back,
    // edit token included — it uses that token to finish the publish. Anything
    // else and a dropped reply becomes two artifacts or a stuck publish.
    current = await startWithArtifacts()
    const token = await signIn(current.origin)
    const first = (await (
      await api(current.origin, '', token, {
        method: 'POST',
        body: HTML_BODY,
        idempotencyKey: 'key-1'
      })
    ).json()) as Created

    const replayed = await api(current.origin, '', token, {
      method: 'POST',
      body: { ...HTML_BODY, content: '<h1>Different</h1>' },
      idempotencyKey: 'key-1'
    })
    expect(replayed.status).toBe(200)
    const second = (await replayed.json()) as Created
    expect(second.artifact.slug).toBe(first.artifact.slug)
    expect(second.editToken).toBe(first.editToken)

    const page = (await (await api(current.origin, '', token)).json()) as { artifacts: unknown[] }
    expect(page.artifacts).toHaveLength(1)
  })

  it('renders markdown and escapes what it renders', async () => {
    current = await startWithArtifacts()
    const token = await signIn(current.origin)
    const created = (await (
      await api(current.origin, '', token, {
        method: 'POST',
        body: {
          content: '# Title\n\n<script>alert(1)</script>',
          contentType: 'text/markdown',
          fileName: 'note.md'
        }
      })
    ).json()) as Created

    const page = await fetch(`${current.origin}/${created.artifact.slug}`)
    const html = await page.text()
    expect(html).toContain('<h1>Title</h1>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('authorization', () => {
  it('refuses an unauthenticated call', async () => {
    current = await startWithArtifacts()
    expect((await fetch(`${current.origin}/v1/artifacts`)).status).toBe(401)
  })

  it('hides an account from another one, and refuses its writes', async () => {
    current = await startWithArtifacts()
    const ada = await signIn(current.origin, 'ada@example.com')
    const grace = await signIn(current.origin, 'grace@example.com')
    const mine = (await (
      await api(current.origin, '', ada, { method: 'POST', body: HTML_BODY })
    ).json()) as Created

    const theirList = (await (await api(current.origin, '', grace)).json()) as {
      artifacts: unknown[]
    }
    expect(theirList.artifacts).toHaveLength(0)

    // 404 rather than 403: another account's slug is not theirs to learn about.
    const theirDelete = await api(current.origin, `/${mine.artifact.slug}`, grace, {
      method: 'DELETE',
      editToken: mine.editToken
    })
    expect(theirDelete.status).toBe(404)
  })

  it('refuses an update carrying the wrong edit token', async () => {
    current = await startWithArtifacts()
    const token = await signIn(current.origin)
    const created = (await (
      await api(current.origin, '', token, { method: 'POST', body: HTML_BODY })
    ).json()) as Created
    const response = await api(current.origin, `/${created.artifact.slug}`, token, {
      method: 'PUT',
      editToken: 'not-the-token',
      body: HTML_BODY
    })
    expect(response.status).toBe(403)
  })

  it('answers a missing artifact with the pair the desktop treats as gone', async () => {
    // artifact-cloud-service swallows exactly 404 + artifact_not_found, which
    // is what makes an interrupted unshare converge instead of retrying.
    current = await startWithArtifacts()
    const token = await signIn(current.origin)
    const response = await api(current.origin, '/does-not-exist', token, { method: 'DELETE' })
    expect(response.status).toBe(404)
    expect((await response.json()) as { code: string }).toMatchObject({
      code: 'artifact_not_found'
    })
  })
})

describe('limits', () => {
  it('refuses a body over the per-artifact ceiling', async () => {
    current = await startWithArtifacts({ maxBytes: 1024 })
    const token = await signIn(current.origin)
    const response = await api(current.origin, '', token, {
      method: 'POST',
      body: { ...HTML_BODY, content: 'x'.repeat(2048) }
    })
    expect(response.status).toBe(413)
  })

  it('refuses one more artifact than the account may hold', async () => {
    current = await startWithArtifacts({ maxPerAccount: 1 })
    const token = await signIn(current.origin)
    expect((await api(current.origin, '', token, { method: 'POST', body: HTML_BODY })).status).toBe(
      201
    )
    const second = await api(current.origin, '', token, { method: 'POST', body: HTML_BODY })
    expect(second.status).toBe(413)
    expect((await second.json()) as { code: string }).toMatchObject({ code: 'too_many' })
  })

  it('lets an update land when only its own older copy filled the account', async () => {
    // The replaced record has to be excluded from the total, or editing an
    // artifact near the cap is refused for space it is about to release.
    current = await startWithArtifacts({ maxTotalBytesPerAccount: 200 })
    const token = await signIn(current.origin)
    const created = (await (
      await api(current.origin, '', token, {
        method: 'POST',
        body: { ...HTML_BODY, content: 'x'.repeat(150) }
      })
    ).json()) as Created
    const updated = await api(current.origin, `/${created.artifact.slug}`, token, {
      method: 'PUT',
      editToken: created.editToken,
      body: { ...HTML_BODY, content: 'y'.repeat(150) }
    })
    expect(updated.status).toBe(200)
  })
})

describe('the published page', () => {
  it('carries the headers that contain a page written by someone else', async () => {
    current = await startWithArtifacts()
    const token = await signIn(current.origin)
    const created = (await (
      await api(current.origin, '', token, { method: 'POST', body: HTML_BODY })
    ).json()) as Created
    const page = await fetch(`${current.origin}/${created.artifact.slug}`)
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(page.headers.get('cache-control')).toBe('no-store')
    const csp = page.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'none'")
  })

  it('serves an HTML artifact verbatim', async () => {
    // Rewriting someone's document is not this server's job; the separate
    // origin is what contains it.
    current = await startWithArtifacts()
    const token = await signIn(current.origin)
    const created = (await (
      await api(current.origin, '', token, {
        method: 'POST',
        body: { ...HTML_BODY, content: '<h1>Kept</h1><script>window.x=1</script>' }
      })
    ).json()) as Created
    const html = await (await fetch(`${current.origin}/${created.artifact.slug}`)).text()
    expect(html).toBe('<h1>Kept</h1><script>window.x=1</script>')
  })
})

describe('durability', () => {
  it('keeps published links working across a restart', async () => {
    current = await startWithArtifacts()
    const token = await signIn(current.origin)
    const created = (await (
      await api(current.origin, '', token, { method: 'POST', body: HTML_BODY })
    ).json()) as Created
    current.relay.artifacts?.flush()

    const { restartTestRelay } = await import('./testing/harness.js')
    current = await restartTestRelay(current)
    const page = await fetch(`${current.origin}/${created.artifact.slug}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Report')
  })

  it('stops serving an artifact once it expires and reclaims it', async () => {
    current = await startWithArtifacts({ ttlMs: 1 })
    const token = await signIn(current.origin)
    const created = (await (
      await api(current.origin, '', token, { method: 'POST', body: HTML_BODY })
    ).json()) as Created
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((await fetch(`${current.origin}/${created.artifact.slug}`)).status).toBe(404)
    const page = (await (await api(current.origin, '', token)).json()) as { artifacts: unknown[] }
    expect(page.artifacts).toHaveLength(0)
    expect(current.relay.artifacts?.size).toBe(0)
  })
})

describe('published links', () => {
  it('serves at the root and keeps the old /a/ form working', async () => {
    // The first release handed out /a/<slug>; a link someone already shared is
    // not ours to break, so both resolve to the same page.
    current = await startWithArtifacts()
    const token = await signIn(current.origin)
    const created = (await (
      await api(current.origin, '', token, { method: 'POST', body: HTML_BODY })
    ).json()) as Created

    expect(created.shareUrl).toBe(`${SHARE_ORIGIN}/${created.artifact.slug}`)
    for (const path of [`/${created.artifact.slug}`, `/a/${created.artifact.slug}`]) {
      const page = await fetch(`${current.origin}${path}`)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('Report')
    }
  })

  it('does not mistake another path for a slug', async () => {
    // A slug is exactly sixteen base64url characters, which is what keeps the
    // root namespace unambiguous next to the write API.
    current = await startWithArtifacts()
    for (const path of ['/v1/artifacts', '/short', '/.well-known/acme-challenge/x']) {
      const response = await fetch(`${current.origin}${path}`)
      expect(response.status).not.toBe(200)
    }
  })
})

describe('the artifact origin serves artifacts and nothing else', () => {
  it('refuses auth, cell, and health routes arriving on the artifact host', async () => {
    // Defence in depth against the proxy, not instead of it. A published page
    // is same-origin with whatever answers on this name, so auth reachable
    // here would undo the reason the origin is separate — and the proxy that
    // is supposed to prevent it is a config file someone can write too loosely.
    // I did exactly that, which is why this is a test rather than a comment.
    current = await startWithArtifacts()
    const host = new URL(SHARE_ORIGIN).host
    for (const path of ['/v1/desktop/auth/methods', '/v1/assign', '/v1/resolve', '/health']) {
      expect(await requestWithHost(current.origin, path, host)).toBe(404)
    }
  })

  it('still answers those routes on the relay host', async () => {
    current = await startWithArtifacts()
    const host = new URL(current.origin).host
    expect(await requestWithHost(current.origin, '/v1/desktop/auth/methods', host)).toBe(200)
    expect(await requestWithHost(current.origin, '/health', host)).toBe(200)
  })

  it('serves the artifact surfaces on the artifact host', async () => {
    current = await startWithArtifacts()
    const host = new URL(SHARE_ORIGIN).host
    expect(await requestWithHost(current.origin, '/v1/artifacts', host, 'POST')).toBe(401)
    expect(await requestWithHost(current.origin, '/AAAAAAAAAAAAAAAA', host)).toBe(404)
  })
})
