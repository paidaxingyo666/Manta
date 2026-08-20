/**
 * The language picker is the only way back out of a language the user cannot
 * read, so its own rows must not depend on the language currently applied.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../app/language-settings.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../../app/settings.tsx', import.meta.url), 'utf8')

describe('language settings screen', () => {
  it('names each language in that language, not the current one', () => {
    const options = source.slice(
      source.indexOf('const languageOptions'),
      source.indexOf('function languageLabel')
    )
    expect(options).toContain("label: 'English'")
    expect(options).toContain("label: '中文'")
    expect(options, 'only the system row has no language of its own').toContain(
      "translate('mobile.settings.language.system'"
    )
  })

  it('persists before applying, because the change remounts the screen', () => {
    const select = source.slice(source.indexOf('const selectLanguage'), source.indexOf('return ('))
    expect(select.indexOf('writeUiLanguage')).toBeLessThan(select.indexOf('setMobileUiLanguage'))
  })

  it('is reachable from Settings', () => {
    expect(settings).toContain("router.push('/language-settings')")
  })
})
