/**
 * The user's UI language preference.
 *
 * Stored separately from host credentials because it is not a secret and must
 * survive a host being forgotten — someone who unpairs every device should not
 * find the app back in a language they cannot read.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  UI_LANGUAGE_SYSTEM,
  normalizeUiLanguage,
  type UiLanguage
} from '../../../src/shared/ui-language'

const STORAGE_KEY = 'manta.ui-language'

export async function readUiLanguage(): Promise<UiLanguage> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY)
    return stored ? normalizeUiLanguage(stored) : UI_LANGUAGE_SYSTEM
  } catch {
    // An unreadable preference must not stop the app from rendering.
    return UI_LANGUAGE_SYSTEM
  }
}

export async function writeUiLanguage(language: UiLanguage): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, language)
}
