/**
 * The shared page's images, asserted on the page itself.
 *
 * The parts were covered and the whole was not, and the whole was where it
 * broke: react-markdown applies `urlTransform` after every rehype plugin, so a
 * `data:` URI the inlining step had just written was emptied on the way out and
 * a `file:` src never survived long enough to be read. Every case here goes
 * through `renderMarkdownArtifactBody` and looks at the HTML, because that is
 * the only thing a reader ever sees.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/runtime/runtime-file-client', () => ({ readRuntimeFilePreview: vi.fn() }))

const files = new Map<string, string>()
const readFile = vi.fn(async ({ filePath }: { filePath: string }) => {
  const content = files.get(filePath)
  return content === undefined
    ? { isBinary: false, content: null }
    : { isBinary: true, content, mimeType: 'image/png' }
})
vi.stubGlobal('window', { api: { fs: { readFile } } })

const { renderMarkdownArtifactBody } = await import('./markdown-artifact-document')

const SOURCE = { filePath: '/repo/notes/README.md' }
const PIXEL = 'iVBORw0KGgoAAAANSUhEUg=='

beforeEach(() => {
  files.clear()
  readFile.mockClear()
})

describe('images on a shared page', () => {
  it('inlines a relative image the document points at', async () => {
    files.set('/repo/notes/shots/a.png', PIXEL)
    const html = await renderMarkdownArtifactBody('![a](./shots/a.png)', SOURCE)
    expect(html).toContain(`src="data:image/png;base64,${PIXEL}"`)
  })

  it('inlines one written as raw HTML, which is how a README writes its logo', async () => {
    files.set('/repo/notes/icon.png', PIXEL)
    const html = await renderMarkdownArtifactBody('<p><img src="icon.png" alt="logo"></p>', SOURCE)
    expect(html).toContain(`src="data:image/png;base64,${PIXEL}"`)
    expect(html).toContain('alt="logo"')
  })

  it('inlines an absolute file: URL, which the default transform used to empty', async () => {
    files.set('/repo/notes/a.png', PIXEL)
    const html = await renderMarkdownArtifactBody('![a](file:///repo/notes/a.png)', SOURCE)
    expect(html).toContain(`src="data:image/png;base64,${PIXEL}"`)
  })

  it('reads a file once however many times and however it is spelled', async () => {
    files.set('/repo/notes/a.png', PIXEL)
    await renderMarkdownArtifactBody(
      '![one](./a.png)\n\n![two](./a.png)\n\n![three](file:///repo/notes/a.png)',
      SOURCE
    )
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('leaves a remote image exactly as written', async () => {
    const html = await renderMarkdownArtifactBody('![r](https://x.test/b.png)', SOURCE)
    expect(html).toContain('src="https://x.test/b.png"')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('drops the src of one it could not read, so the alt text shows instead', async () => {
    const html = await renderMarkdownArtifactBody('![gone](./missing.png)', SOURCE)
    expect(html).toContain('alt="gone"')
    expect(html).not.toContain('missing.png')
    expect(html).not.toContain('src=')
  })

  it('never leaves a file: URL on the page, read or not', async () => {
    const html = await renderMarkdownArtifactBody(
      '![gone](file:///Users/someone/private/a.png)',
      SOURCE
    )
    expect(html).not.toContain('file:')
    expect(html).not.toContain('/Users/someone')
  })

  it('stops at the budget rather than failing the share', async () => {
    // Two images either side of what a page may carry: the first fits, the
    // second does not, and the page still renders with both alt texts.
    files.set('/repo/notes/big.png', 'A'.repeat(5 * 1024 * 1024))
    files.set('/repo/notes/bigger.png', 'B'.repeat(5 * 1024 * 1024))
    const html = await renderMarkdownArtifactBody(
      '![first](./big.png)\n\n![second](./bigger.png)',
      SOURCE
    )
    expect(html).toContain('data:image/png;base64,AAA')
    expect(html).not.toContain('data:image/png;base64,BBB')
    expect(html).toContain('alt="second"')
  })

  it('drops local images when nothing says where the document lives', async () => {
    // Same answer as an unreadable one, and for the same reason: without a
    // source path there is nothing to resolve a relative image against, so the
    // page cannot carry it and must not pretend to.
    const html = await renderMarkdownArtifactBody('![a](./shots/a.png)')
    expect(readFile).not.toHaveBeenCalled()
    expect(html).toContain('alt="a"')
    expect(html).not.toContain('src=')
  })
})
