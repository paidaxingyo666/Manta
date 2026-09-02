/**
 * Applies the stored UI language, and re-renders the app when it changes.
 *
 * Two things are load-bearing here.
 *
 * The stored preference arrives asynchronously, so no language is applied until
 * it does. Defaulting to the device locale in the meantime would start a
 * language change that races the persisted choice and can win, leaving the app
 * in a language the user explicitly turned off.
 *
 * And `translate()` is a plain function, not a hook — nothing subscribes to
 * i18next, so a language change alone repaints nothing. Remounting the subtree
 * by key is blunt, but it is correct for every screen at once, and switching
 * language is a once-in-the-life-of-an-install action rather than something on
 * a hot path.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import { i18n, resolveMobileLocale, setMobileUiLanguage } from './i18n'
import { readUiLanguage } from './ui-language-store'
import { UI_LANGUAGE_SYSTEM, type UiLanguage } from '../../../src/shared/ui-language'

/**
 * How long to wait for the stored preference before rendering anyway.
 *
 * Nothing below this provider renders until a language is settled, and the
 * root view's onLayout is what dismisses the splash screen — so a storage read
 * that never resolves would strand the app on the splash forever. Falling back
 * to the device language costs a re-mount if the stored choice arrives later,
 * which is far cheaper than a hang.
 */
const STORED_LANGUAGE_TIMEOUT_MS = 1500

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element | null {
  const [locale, setLocale] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fallback = setTimeout(() => {
      if (!cancelled) {
        setLocale((previous) => previous ?? resolveMobileLocale(UI_LANGUAGE_SYSTEM))
      }
    }, STORED_LANGUAGE_TIMEOUT_MS)
    void readUiLanguage().then(async (language: UiLanguage) => {
      await setMobileUiLanguage(language)
      if (!cancelled) {
        setLocale(resolveMobileLocale(language))
      }
    })
    const onChanged = (next: string): void => {
      if (!cancelled) {
        setLocale(next)
      }
    }
    i18n.on('languageChanged', onChanged)
    return () => {
      cancelled = true
      clearTimeout(fallback)
      i18n.off('languageChanged', onChanged)
    }
  }, [])

  return (
    <I18nextProvider i18n={i18n}>
      {locale === null ? null : <Fragment key={locale}>{children}</Fragment>}
    </I18nextProvider>
  )
}
