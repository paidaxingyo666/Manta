/**
 * The JSX-text rewrite replaces the whole text node but the catalog value is
 * compacted, so a trailing space that separated the text from the next
 * expression is easy to drop — "Connects to {host}" then renders glued.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { main } from './localize-renderer-strings.mjs'

async function localizeFixture(source: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'localize-jsx-'))
  const subtree = 'tree'
  await mkdir(path.join(root, subtree, 'src', 'i18n', 'locales'), { recursive: true })
  await mkdir(path.join(root, 'mobile', 'src', 'i18n', 'locales'), { recursive: true })
  await writeFile(path.join(root, 'mobile', 'src', 'i18n', 'locales', 'en.json'), '{}\n')
  const file = path.join(root, subtree, 'Fixture.tsx')
  await writeFile(file, source)

  const previous = process.env.MOBILE_I18N_SUBTREE
  process.env.MOBILE_I18N_SUBTREE = subtree
  try {
    expect(await main(root, ['--target', 'mobile'])).toBe(0)
  } finally {
    if (previous === undefined) {
      delete process.env.MOBILE_I18N_SUBTREE
    } else {
      process.env.MOBILE_I18N_SUBTREE = previous
    }
  }
  return await readFile(file, 'utf8')
}

describe('JSX text rewriting', () => {
  it('keeps the space between text and a following expression', async () => {
    const out = await localizeFixture(
      'export const F = ({ host }: { host: string }) => <span>Connects to {host}</span>\n'
    )
    expect(out).toContain('Connects to")} {host}')
  })

  it('gives colliding candidates distinct keys', async () => {
    // `Allow ${tool}?` and 'Allow' compact to the same text, so a hash over the
    // text alone lets one catalog entry overwrite the other.
    const out = await localizeFixture(
      'export const F = (tool: string) => ({\n' +
        '  title: `Allow ${tool}?`,\n' +
        "  label: 'Allow'\n" +
        '})\n'
    )
    const keys = [...out.matchAll(/translate\(\s*"([^"]+)"/g)].map((m) => m[1])
    expect(new Set(keys).size).toBe(keys.length)
  })
})
