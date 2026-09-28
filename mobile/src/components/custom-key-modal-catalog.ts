/**
 * The custom-key picker's catalogs, split from the modal because their labels are localized —
 * `localizedConstant` rebuilds them per language.
 */

import {
  TERMINAL_SHORTCUT_SPECIAL_KEYS,
  type TerminalShortcutModifier,
  type TerminalShortcutSpecialKey
} from '../terminal/terminal-accessory-keys'
import { translate } from '../i18n/i18n'
import { localizedConstant } from '../i18n/localized-constant'

// Why: Alt is rendered with the ⌥ glyph because on macOS hosts the Option key
// is the only modifier that produces an ESC-prefixed byte sequence terminals
// can read. Cmd is intentionally absent — macOS swallows it before keystrokes
// reach the shell, so there's nothing to encode.
export const shortcutModifierCatalog = localizedConstant(
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
export const specialKeyGroups = localizedConstant(
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

export const SPECIAL_KEY_BY_ID: Record<string, TerminalShortcutSpecialKey> = Object.fromEntries(
  TERMINAL_SHORTCUT_SPECIAL_KEYS.map((key) => [key.id, key])
)
