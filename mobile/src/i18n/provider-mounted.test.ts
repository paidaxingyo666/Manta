/**
 * The stored language is only applied by I18nProvider's effect. Without it
 * mounted, i18next keeps whatever `lng` init guessed from the device locale —
 * the app opens in English while Settings correctly shows 中文 selected, and
 * only a manual switch (which calls changeLanguage directly) fixes it until
 * the next launch.
 *
 * The component existing is not the same as it being rendered, which is
 * exactly how it went missing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const layout = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8')

describe('root layout', () => {
  it('mounts I18nProvider', () => {
    expect(layout).toContain("import { I18nProvider } from '../src/i18n/I18nProvider'")
    expect(layout).toContain('<I18nProvider>')
    expect(layout).toContain('</I18nProvider>')
  })

  it('wraps the navigator, so no screen renders before the language is applied', () => {
    const open = layout.indexOf('<I18nProvider>')
    const close = layout.indexOf('</I18nProvider>')
    const stack = layout.indexOf('<Stack')
    expect(open).toBeGreaterThan(-1)
    expect(stack).toBeGreaterThan(open)
    expect(stack).toBeLessThan(close)
  })
})
