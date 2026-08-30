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

// Re-exported so callers keep importing key definitions and the encoder from one
// place; the definitions live apart only because they are localized.
export {
  TERMINAL_SHORTCUT_SPECIAL_KEYS,
  terminalAccessoryKeys
} from './terminal-accessory-key-definitions'

export function buildTerminalShortcutKey(
  binding: TerminalShortcutBinding
): TerminalShortcutBuildResult | null {
  const key = normalizeShortcutKey(binding.key)
  if (!key) {
    return null
  }
  const modifiers = normalizeModifiers(binding.modifiers)
  const bytes = buildShortcutBytes(key, modifiers)
  if (bytes == null) {
    return null
  }
  const label = formatShortcutLabel(key, modifiers)
  return {
    label,
    bytes,
    accessibilityLabel: label.replaceAll('+', ' ')
  }
}

export function normalizeShortcutKeyInput(value: string): string | null {
  const chars = Array.from(value)
  const firstVisible = chars.find((char) => char !== '\n' && char !== '\r' && char !== '\t')
  if (!firstVisible) {
    return null
  }
  return normalizeShortcutKey(firstVisible)
}

function buildShortcutBytes(key: string, modifiers: TerminalShortcutModifier[]): string | null {
  if (key === 'space') {
    return buildPrintableShortcutBytes(' ', modifiers)
  }
  const csiFinal = CSI_FINAL_SPECIAL_KEYS[key]
  if (csiFinal) {
    // Why: xterm encodes unmodified F1-F4 as SS3 (ESC O P/S). Once a
    // modifier is present it switches to the CSI 1;N form like arrows.
    if (SS3_BASE_SPECIAL_KEYS.has(key) && csiModifierParameter(modifiers) === 1) {
      return `${ESC}O${csiFinal}`
    }
    return buildCsiFinalShortcut(csiFinal, modifiers)
  }
  const csiTilde = CSI_TILDE_SPECIAL_KEYS[key]
  if (csiTilde) {
    return buildCsiTildeShortcut(csiTilde, modifiers)
  }
  if (key === 'tab') {
    if (modifiers.includes('shift') && !modifiers.includes('ctrl') && !modifiers.includes('alt')) {
      return `${ESC}[Z`
    }
    const bytes = '\t'
    return modifiers.includes('alt') ? `${ESC}${bytes}` : bytes
  }
  if (key === 'escape') {
    const bytes = ESC
    return modifiers.includes('alt') ? `${ESC}${bytes}` : bytes
  }
  if (key === 'enter') {
    const bytes = '\r'
    return modifiers.includes('alt') ? `${ESC}${bytes}` : bytes
  }
  if (key === 'backspace') {
    const bytes = modifiers.includes('ctrl') ? '\b' : '\x7f'
    return modifiers.includes('alt') ? `${ESC}${bytes}` : bytes
  }
  if (isPrintableShortcutKey(key)) {
    return buildPrintableShortcutBytes(key, modifiers)
  }
  return null
}

function buildPrintableShortcutBytes(
  key: string,
  modifiers: TerminalShortcutModifier[]
): string | null {
  const shifted = modifiers.includes('shift') ? applyShift(key) : key
  let bytes = shifted
  if (modifiers.includes('ctrl')) {
    const ctrlBytes = controlBytesForPrintable(shifted)
    if (ctrlBytes == null) {
      return null
    }
    bytes = ctrlBytes
  }
  return modifiers.includes('alt') ? `${ESC}${bytes}` : bytes
}

function buildCsiFinalShortcut(final: string, modifiers: TerminalShortcutModifier[]): string {
  const parameter = csiModifierParameter(modifiers)
  return parameter === 1 ? `${ESC}[${final}` : `${ESC}[1;${parameter}${final}`
}

function buildCsiTildeShortcut(code: number, modifiers: TerminalShortcutModifier[]): string {
  const parameter = csiModifierParameter(modifiers)
  return parameter === 1 ? `${ESC}[${code}~` : `${ESC}[${code};${parameter}~`
}

function csiModifierParameter(modifiers: TerminalShortcutModifier[]): number {
  let parameter = 1
  if (modifiers.includes('shift')) {
    parameter += 1
  }
  if (modifiers.includes('alt')) {
    parameter += 2
  }
  if (modifiers.includes('ctrl')) {
    parameter += 4
  }
  return parameter
}

function controlBytesForPrintable(key: string): string | null {
  const lower = key.toLowerCase()
  if (lower >= 'a' && lower <= 'z') {
    return String.fromCharCode(lower.charCodeAt(0) - 96)
  }
  return CTRL_PRINTABLE_BYTES[key] ?? null
}

function applyShift(key: string): string {
  if (key >= 'a' && key <= 'z') {
    return key.toUpperCase()
  }
  if (key >= 'A' && key <= 'Z') {
    return key
  }
  return SHIFTED_PRINTABLE[key] ?? key
}

function normalizeModifiers(modifiers: TerminalShortcutModifier[]): TerminalShortcutModifier[] {
  const selected = new Set(modifiers)
  return MODIFIER_ORDER.filter((modifier) => selected.has(modifier))
}

function normalizeShortcutKey(key: string): string | null {
  if (SPECIAL_KEY_LABELS[key]) {
    return key
  }
  if (key.length === 1 && isPrintableShortcutKey(key)) {
    return key >= 'A' && key <= 'Z' ? key.toLowerCase() : key
  }
  return null
}

function isPrintableShortcutKey(key: string): boolean {
  return key.length === 1 && key >= ' ' && key <= '~'
}

function formatShortcutLabel(key: string, modifiers: TerminalShortcutModifier[]): string {
  const modifierLabels = modifiers.map((modifier) => MODIFIER_LABELS[modifier])
  return [...modifierLabels, displayKeyLabel(key)].join('+')
}

function displayKeyLabel(key: string): string {
  if (SPECIAL_KEY_LABELS[key]) {
    return SPECIAL_KEY_LABELS[key]
  }
  if (key === ' ') {
    return 'Space'
  }
  return key.length === 1 && key >= 'a' && key <= 'z' ? key.toUpperCase() : key
}
