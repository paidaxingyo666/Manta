/**
 * The device's UI language.
 *
 * Read through `Intl` rather than expo-localization on purpose. Hermes ships
 * full ICU, so this needs no native module — which means no prebuild, no
 * rebuild, and no reinstall on every device just to learn what language the
 * phone is set to.
 */
import { DEFAULT_UI_LOCALE } from '../../../src/shared/ui-locale'

export function getDeviceLocale(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale
    return typeof resolved === 'string' && resolved ? resolved : DEFAULT_UI_LOCALE
  } catch {
    // A JS engine without Intl still has to render something.
    return DEFAULT_UI_LOCALE
  }
}
