/**
 * The picker catalogs and the shapes they produce.
 *
 * Split from the modal because these labels are localized — `localizedConstant`
 * rebuilds them per language — and the component is long enough without them.
 */
import { useCallback, useMemo, useState } from 'react'
import { View, Text, Pressable, TextInput, Switch } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { colors } from '../theme/mobile-theme'
import { BottomDrawer } from './BottomDrawer'
import {
  buildTerminalShortcutKey,
  normalizeShortcutKeyInput,
  TERMINAL_SHORTCUT_SPECIAL_KEYS,
  type TerminalShortcutModifier,
  type TerminalShortcutSpecialKey
} from '../terminal/terminal-accessory-keys'
import { translate } from '../i18n/i18n'
import { localizedConstant } from '../i18n/localized-constant'
import { styles } from './custom-key-modal-styles'

const CUSTOM_ACCESSORY_KEYS_STORAGE_KEY = 'manta:custom-accessory-keys'

export type CustomKey = {
  id: string
  label: string
  bytes: string
  enter: boolean
}

type Step = 'choose-type' | 'shortcut-combo' | 'special-keys' | 'text-macro'

// Why: Alt is rendered with the ⌥ glyph because on macOS hosts the Option key
// is the only modifier that produces an ESC-prefixed byte sequence terminals
// can read. Cmd is intentionally absent — macOS swallows it before keystrokes
// reach the shell, so there's nothing to encode.
const shortcutModifierCatalog = localizedConstant(
  (): { id: TerminalShortcutModifier; label: string; glyph?: string }[] => [
    {
      id: 'ctrl',
      label: translate('m.CustomKeyModal.3992c2101a', 'Ctrl')
    },
    {
      id: 'alt',
      label: translate('m.CustomKeyModal.333faa20ee', 'Alt'),
      glyph: '⌥'
    },
    {
      id: 'shift',
      label: translate('m.CustomKeyModal.0e5f660272', 'Shift')
    }
  ]
)

// Why: special keys are grouped by purpose so the picker reads as three small
// fixed grids rather than one ragged wrap row that clipped F7-F12.
const specialKeyGroups = localizedConstant(
  (): { title: string; ids: string[]; columns: number }[] => [
    {
      title: translate('m.CustomKeyModal.d51ba74b66', 'Editing'),
      ids: ['escape', 'tab', 'enter', 'backspace', 'delete', 'insert', 'space'],
      columns: 4
    },
    {
      title: translate('m.CustomKeyModal.0a58036543', 'Navigation'),
      ids: ['arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight', 'home', 'end', 'pageUp', 'pageDown'],
      columns: 4
    },
    {
      title: translate('m.CustomKeyModal.5b029b4c49', 'Function'),
      ids: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'],
      columns: 6
    }
  ]
)

const SPECIAL_KEY_BY_ID: Record<string, TerminalShortcutSpecialKey> = Object.fromEntries(
  TERMINAL_SHORTCUT_SPECIAL_KEYS.map((key) => [key.id, key])
)

type Props = {
  visible: boolean
  onClose: () => void
  onKeysChanged: (keys: CustomKey[]) => void
  onManageShortcuts?: () => void
}

export async function loadCustomKeys(): Promise<CustomKey[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_ACCESSORY_KEYS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CustomKey[]) : []
  } catch {
    return []
  }
}

export async function saveCustomKeys(keys: CustomKey[]): Promise<void> {
  await AsyncStorage.setItem(CUSTOM_ACCESSORY_KEYS_STORAGE_KEY, JSON.stringify(keys))
}
