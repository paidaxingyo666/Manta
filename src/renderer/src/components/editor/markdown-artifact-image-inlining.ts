/**
 * Carries a shared page's images with it, as data URIs.
 *
 * A shared page is a single stored document and nothing else, so an image the
 * author sees locally has no way to reach a reader: `file:///Users/…` is theirs
 * alone, and `./shots/a.png` resolves against the artifact origin, which has no
 * such file. Both arrive as a broken image with no hint of why.
 *
 * Reading the bytes at share time and inlining them makes the page
 * self-contained — no second store to provision, no lifetime to reconcile
 * against the artifact's own, no orphan to collect when a page is replaced.
 * Remote and http images are already portable and are left exactly as written.
 */
import { resolveImageAbsolutePath } from './markdown-preview-links'
import { readLocalImagePreview } from './local-image-src-reader'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'

export type ArtifactImageContext = {
  connectionId?: string | null
  runtimeContext?:
    | (Omit<RuntimeFileOperationArgs, 'connectionId'> & { connectionId?: string | null })
    | null
}

/**
 * How much encoded image a page may carry.
 *
 * The relay's own ceiling is 10 MB for the whole artifact; base64 costs a third
 * on top of the bytes, and the prose still has to fit. Six leaves room for both
 * and is far more than a document of screenshots needs.
 */
const MAX_INLINE_BYTES = 6 * 1024 * 1024

/** Already portable: it resolves the same for a reader as for the author. */
function isPortable(src: string): boolean {
  return /^(?:https?:|data:)/i.test(src)
}

/**
 * Every `src` on an `<img>` in rendered HTML.
 *
 * Reading, not securing — what may appear in the published page is still
 * decided by the sanitizer, which runs after this on a real element tree. A
 * regex here only has to find candidates to go and read.
 */
export function collectArtifactImageSources(html: string): string[] {
  const found = new Set<string>()
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1]
    if (src && !isPortable(src)) {
      found.add(decodeHtmlEntities(src))
    }
  }
  return [...found]
}

/** React escapes attribute values; the raw src is what the resolver needs. */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Reads what it can and reports what it could not, keyed by the src as written.
 *
 * A file that has moved, is not an image, or would push the page past the
 * budget is left out rather than failing the share: the sanitizer then drops
 * its unresolvable `src` and the browser shows the alt text, which says more to
 * a reader than a broken-image icon does.
 */
export async function buildArtifactImageDataUris(
  sources: readonly string[],
  filePath: string,
  context: ArtifactImageContext = {}
): Promise<Map<string, string>> {
  const inlined = new Map<string, string>()
  let budget = MAX_INLINE_BYTES
  for (const src of sources) {
    const absolutePath = resolveImageAbsolutePath(src, filePath)
    if (!absolutePath) {
      continue
    }
    const dataUri = await readAsDataUri(absolutePath, context)
    if (!dataUri || dataUri.length > budget) {
      continue
    }
    budget -= dataUri.length
    inlined.set(src, dataUri)
  }
  return inlined
}

type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/**
 * Swaps in the data URIs, before the sanitizer runs.
 *
 * Order is the whole safety argument. This only rewrites; what survives into
 * the page is still the sanitizer's decision, so an image that could not be
 * read keeps the `file:` or relative `src` it was written with and is dropped
 * there, exactly as it would have been without this step. Nothing here can
 * widen what a shared page is allowed to carry.
 */
export function rehypeInlineArtifactImages(inlined: ReadonlyMap<string, string>) {
  return () =>
    (tree: HastNode): void => {
      const visit = (node: HastNode): void => {
        if (node.tagName === 'img' && node.properties) {
          const src = node.properties.src
          if (typeof src === 'string') {
            const dataUri = inlined.get(src)
            if (dataUri) {
              node.properties.src = dataUri
            }
          }
        }
        for (const child of node.children ?? []) {
          visit(child)
        }
      }
      visit(tree)
    }
}

async function readAsDataUri(
  absolutePath: string,
  context: ArtifactImageContext
): Promise<string | null> {
  try {
    const result = await readLocalImagePreview(
      absolutePath,
      context.connectionId,
      context.runtimeContext ?? undefined
    )
    if (!result.isBinary || !result.content) {
      return null
    }
    return `data:${result.mimeType ?? 'image/png'};base64,${result.content.replace(/\s/g, '')}`
  } catch {
    return null
  }
}
