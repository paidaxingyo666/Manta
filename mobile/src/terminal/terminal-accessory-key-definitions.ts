/**
 * The accessory-row key definitions, split out from the shortcut encoder.
 *
 * Kept apart because the labels are localized — `localizedConstant` re-runs them
 * per language — while everything that turns a binding into bytes is pure and
 * has no reason to reload.
 */
import { localizedConstant } from '../i18n/localized-constant'
import { translate } from '../i18n/i18n'
import {
  CSI_FINAL_SPECIAL_KEYS,
  CSI_TILDE_SPECIAL_KEYS,
  CTRL_PRINTABLE_BYTES,
  ESC,
  MODIFIER_LABELS,
  MODIFIER_ORDER,
  SHIFTED_PRINTABLE,
  SPECIAL_KEY_ACCESSIBILITY_LABELS,
  SPECIAL_KEY_LABELS,
  SS3_BASE_SPECIAL_KEYS
} from './terminal-key-encoding-tables'
export type {
  TerminalAccessoryKey,
  TerminalShortcutBinding,
  TerminalShortcutBuildResult,
  TerminalShortcutModifier,
  TerminalShortcutSpecialKey
} from './terminal-shortcut-types'
import type {
  TerminalAccessoryKey,
  TerminalShortcutBinding,
  TerminalShortcutBuildResult,
  TerminalShortcutModifier,
  TerminalShortcutSpecialKey
} from './terminal-shortcut-types'

export const TERMINAL_SHORTCUT_SPECIAL_KEYS: TerminalShortcutSpecialKey[] = [
  'escape',
  'tab',
  'enter',
  'backspace',
  'delete',
  'insert',
  'arrowUp',
  'arrowDown',
  'arrowLeft',
  'arrowRight',
  'home',
  'end',
  'pageUp',
  'pageDown',
  'space',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12'
].map((id) => ({
  id,
  label: SPECIAL_KEY_LABELS[id]!,
  accessibilityLabel: SPECIAL_KEY_ACCESSIBILITY_LABELS[id]!
}))

// i18n-exempt: `label` is the keycap — someone hunting for Ctrl+U on their
// keyboard needs to read "Ctrl+U". The description beside it is
// accessibilityLabel, which does go through the catalog.
export const terminalAccessoryKeys = localizedConstant((): TerminalAccessoryKey[] => [
  {
    id: 'escape',
    label: 'Esc',
    bytes: '\x1b',
    accessibilityLabel: translate('m.terminal.accessory.keys.8c77ba5145', 'Escape')
  },
  {
    id: 'tab',
    label: 'Tab',
    bytes: '\t',
    accessibilityLabel: translate('m.terminal.accessory.keys.84ce4a500c', 'Tab')
  },
  {
    id: 'enter',
    label: 'Enter',
    bytes: '\r',
    accessibilityLabel: translate('m.terminal.accessory.keys.f4a168e733', 'Enter')
  },
  // Why: terminal apps recognize ESC [ Z as the reverse-tab sequence.
  {
    id: 'shiftTab',
    label: 'Shift+Tab',
    bytes: '\x1b[Z',
    accessibilityLabel: translate('m.terminal.accessory.keys.a7bfddd855', 'Shift Tab')
  },
  {
    id: 'space',
    label: 'Space',
    bytes: ' ',
    accessibilityLabel: translate('m.terminal.accessory.keys.97a2894f73', 'Space')
  },
  {
    id: 'backspace',
    label: '⌫',
    bytes: '\x7f',
    accessibilityLabel: translate('m.terminal.accessory.keys.e9344f8a27', 'Backspace'),
    repeatable: true
  },
  {
    id: 'delete',
    label: 'Del',
    bytes: '\x1b[3~',
    accessibilityLabel: translate('m.terminal.accessory.keys.7cd80393da', 'Forward delete'),
    repeatable: true
  },
  {
    id: 'arrowUp',
    label: '↑',
    bytes: '\x1b[A',
    accessibilityLabel: translate('m.terminal.accessory.keys.230262f136', 'Arrow Up'),
    repeatable: true
  },
  {
    id: 'arrowDown',
    label: '↓',
    bytes: '\x1b[B',
    accessibilityLabel: translate('m.terminal.accessory.keys.bd5b32eea9', 'Arrow Down'),
    repeatable: true
  },
  {
    id: 'arrowLeft',
    label: '←',
    bytes: '\x1b[D',
    accessibilityLabel: translate('m.terminal.accessory.keys.4621886af3', 'Arrow Left'),
    repeatable: true
  },
  {
    id: 'arrowRight',
    label: '→',
    bytes: '\x1b[C',
    accessibilityLabel: translate('m.terminal.accessory.keys.bf959218ed', 'Arrow Right'),
    repeatable: true
  },
  {
    id: 'ctrlC',
    label: 'Ctrl+C',
    bytes: '\x03',
    accessibilityLabel: translate('m.terminal.accessory.keys.0331e84333', 'Interrupt terminal')
  },
  {
    id: 'ctrlD',
    label: 'Ctrl+D',
    bytes: '\x04',
    accessibilityLabel: translate('m.terminal.accessory.keys.3c13e73de4', 'Send EOF')
  },
  {
    id: 'ctrlL',
    label: 'Ctrl+L',
    bytes: '\x0c',
    accessibilityLabel: translate('m.terminal.accessory.keys.12a6a3f286', 'Clear screen')
  },
  {
    id: 'ctrlZ',
    label: 'Ctrl+Z',
    bytes: '\x1a',
    accessibilityLabel: translate('m.terminal.accessory.keys.86a59f3660', 'Suspend process')
  },
  {
    id: 'ctrlR',
    label: 'Ctrl+R',
    bytes: '\x12',
    accessibilityLabel: translate('m.terminal.accessory.keys.99cbc77f8a', 'Reverse search')
  },
  {
    id: 'ctrlA',
    label: 'Ctrl+A',
    bytes: '\x01',
    accessibilityLabel: translate('m.terminal.accessory.keys.08a169fd03', 'Start of line')
  },
  {
    id: 'ctrlE',
    label: 'Ctrl+E',
    bytes: '\x05',
    accessibilityLabel: translate('m.terminal.accessory.keys.d155ad54ef', 'End of line')
  },
  {
    id: 'ctrlW',
    label: 'Ctrl+W',
    bytes: '\x17',
    accessibilityLabel: translate('m.terminal.accessory.keys.05df6a7dd9', 'Delete word backward')
  },
  {
    id: 'ctrlU',
    label: 'Ctrl+U',
    bytes: '\x15',
    accessibilityLabel: translate(
      'm.terminal.accessory.keys.1eb5ac7433',
      'Clear line before cursor'
    )
  }
])
