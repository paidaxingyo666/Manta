/**
 * The terminal's key-encoding tables.
 *
 * Split from terminal-accessory-keys so the byte-sequence builders there stay
 * readable next to each other rather than pages apart. These are reference
 * data — what a key is called, what bytes it sends — and change only when a
 * terminal's escape vocabulary does.
 */
import type { TerminalShortcutModifier } from './terminal-shortcut-types'

export const ESC = '\x1b'

export const MODIFIER_LABELS: Record<TerminalShortcutModifier, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift'
}

export const MODIFIER_ORDER: TerminalShortcutModifier[] = ['ctrl', 'alt', 'shift']

export const SHIFTED_PRINTABLE: Record<string, string> = {
  '`': '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?'
}

export const CTRL_PRINTABLE_BYTES: Record<string, string> = {
  ' ': '\x00',
  '@': '\x00',
  '`': '\x00',
  '[': '\x1b',
  '{': '\x1b',
  '\\': '\x1c',
  '|': '\x1c',
  ']': '\x1d',
  '}': '\x1d',
  '^': '\x1e',
  '~': '\x1e',
  _: '\x1f',
  '?': '\x7f'
}

export const SPECIAL_KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  tab: 'Tab',
  enter: 'Enter',
  backspace: '⌫',
  delete: 'Del',
  insert: 'Ins',
  arrowUp: '↑',
  arrowDown: '↓',
  arrowLeft: '←',
  arrowRight: '→',
  home: 'Home',
  end: 'End',
  pageUp: 'PgUp',
  pageDown: 'PgDn',
  space: 'Space',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12'
}

export const SPECIAL_KEY_ACCESSIBILITY_LABELS: Record<string, string> = {
  escape: 'Escape',
  tab: 'Tab',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Forward delete',
  insert: 'Insert',
  arrowUp: 'Arrow up',
  arrowDown: 'Arrow down',
  arrowLeft: 'Arrow left',
  arrowRight: 'Arrow right',
  home: 'Home',
  end: 'End',
  pageUp: 'Page up',
  pageDown: 'Page down',
  space: 'Space',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12'
}

export const CSI_FINAL_SPECIAL_KEYS: Record<string, string> = {
  arrowUp: 'A',
  arrowDown: 'B',
  arrowRight: 'C',
  arrowLeft: 'D',
  home: 'H',
  end: 'F',
  f1: 'P',
  f2: 'Q',
  f3: 'R',
  f4: 'S'
}

export const SS3_BASE_SPECIAL_KEYS = new Set(['f1', 'f2', 'f3', 'f4'])

export const CSI_TILDE_SPECIAL_KEYS: Record<string, number> = {
  insert: 2,
  delete: 3,
  pageUp: 5,
  pageDown: 6,
  f5: 15,
  f6: 17,
  f7: 18,
  f8: 19,
  f9: 20,
  f10: 21,
  f11: 23,
  f12: 24
}
