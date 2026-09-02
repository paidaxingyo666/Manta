/**
 * Mobile translation runtime.
 *
 * Deliberately the same `translate(key, fallback)` shape as the desktop's, so
 * the shared extraction pipeline can rewrite either tree and a string moved
 * between them keeps working. The catalogs stay separate — the two apps say
 * different things — but the key format and the fallback-is-the-source-text
 * rule are identical.
 *
 * Unlike the desktop this bundles every locale eagerly. There the non-English
 * catalogs added megabytes to a startup chunk parsed on every launch; here
 * Metro bundles the app as one artifact anyway, so a lazy backend would buy
 * nothing and cost a failure mode.
 */
import i18next, { type i18n as I18nInstance, type TOptions } from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import zh from './locales/zh.json'
import { getDeviceLocale } from './device-locale'
import {
  DEFAULT_UI_LOCALE,
  normalizeSupportedUiLocale,
  resolveUiLocale
} from '../../../src/shared/ui-locale'
import type { UiLanguage } from '../../../src/shared/ui-language'

export const i18n: I18nInstance = i18next.createInstance()

/**
 * Locales with a real catalog on mobile.
 *
 * The desktop ships five. Adding one here without a reviewed catalog would
 * silently fall back to English for every missing key, which reads as a
 * half-translated app rather than as an untranslated one.
 */
export const MOBILE_LOCALES = { en, zh } as const
export type MobileLocale = keyof typeof MOBILE_LOCALES

void i18n.use(initReactI18next).init({
  fallbackLng: DEFAULT_UI_LOCALE,
  lng: resolveMobileLocale('system'),
  resources: Object.fromEntries(
    Object.entries(MOBILE_LOCALES).map(([locale, translation]) => [locale, { translation }])
  ),
  interpolation: { escapeValue: false },
  react: { useSuspense: false }
})

/** Maps a UI language preference onto a locale this app actually carries. */
export function resolveMobileLocale(language: UiLanguage): string {
  const resolved = normalizeSupportedUiLocale(resolveUiLocale(language, getDeviceLocale()))
  return resolved in MOBILE_LOCALES ? resolved : DEFAULT_UI_LOCALE
}

/**
 * Translates a key, falling back to the English source text.
 *
 * The fallback is not a convenience — it is what makes an un-extracted or
 * newly added string render as itself instead of as a raw key, so a missing
 * catalog entry is a cosmetic gap rather than a broken screen.
 */
export function translate(key: string, fallback: string, options?: TOptions): string {
  return i18n.t(key, { defaultValue: fallback, ...options })
}

export async function setMobileUiLanguage(language: UiLanguage): Promise<void> {
  const locale = resolveMobileLocale(language)
  if (i18n.language !== locale) {
    await i18n.changeLanguage(locale)
  }
}
